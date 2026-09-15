package com.sellix.pos.printer;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.core.content.IntentCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Direct, offline receipt-printer transport for Sellix POS.
 *
 * Budget ESC/POS printers such as the POS-5890U-L are Bluetooth *Classic* (SPP / RFCOMM)
 * devices, not Bluetooth LE, and also expose a USB printer interface. This plugin talks to
 * both directly from the Android device - no network, no API server.
 *
 * All socket / USB I/O runs on one background thread, so jobs can never interleave and the
 * UI thread is never blocked.
 */
@SuppressLint("MissingPermission")
@CapacitorPlugin(
    name = "SellixPrinter",
    permissions = {
        @Permission(
            alias = SellixPrinterPlugin.ALIAS_NEARBY,
            strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }
        ),
        @Permission(alias = SellixPrinterPlugin.ALIAS_LOCATION, strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class SellixPrinterPlugin extends Plugin {

    static final String ALIAS_NEARBY = "bluetoothNearby";
    static final String ALIAS_LOCATION = "bluetoothLocation";

    private static final String TAG = "SellixPrinter";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String ACTION_USB_PERMISSION = "com.sellix.pos.printer.USB_PERMISSION";

    // Small, paced Bluetooth writes: cheap printers have tiny receive buffers and silently
    // drop data when flooded.
    private static final int BT_CHUNK_SIZE = 512;
    private static final int BT_CHUNK_DELAY_MS = 15;
    private static final int USB_CHUNK_SIZE = 4096;
    private static final int USB_TIMEOUT_MS = 5000;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Object lock = new Object();

    // Bluetooth connection
    private BluetoothSocket btSocket;
    private OutputStream btOut;
    private String btAddress;
    private String btName;

    // USB connection
    private UsbDeviceConnection usbConnection;
    private UsbInterface usbInterface;
    private UsbEndpoint usbOut;
    private UsbDevice usbDevice;

    private BroadcastReceiver systemReceiver;
    private BroadcastReceiver usbPermissionReceiver;
    private BroadcastReceiver discoveryReceiver;
    private final Set<String> discoveredAddresses = new HashSet<>();

    private PluginCall pendingUsbCall;
    private UsbDevice pendingUsbDevice;

    /* ------------------------------------------------------------------
       LIFECYCLE
    ------------------------------------------------------------------ */

    @Override
    public void load() {
        systemReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (action == null) return;

                switch (action) {
                    case BluetoothDevice.ACTION_ACL_DISCONNECTED: {
                        BluetoothDevice device = IntentCompat.getParcelableExtra(intent, BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
                        String current;
                        synchronized (lock) {
                            current = btAddress;
                        }
                        if (device != null && current != null && current.equalsIgnoreCase(device.getAddress())) {
                            io.execute(() -> closeBluetooth("Printer was turned off or went out of range"));
                        }
                        break;
                    }
                    case BluetoothAdapter.ACTION_STATE_CHANGED: {
                        int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
                        if (state == BluetoothAdapter.STATE_TURNING_OFF || state == BluetoothAdapter.STATE_OFF) {
                            io.execute(() -> closeBluetooth("Bluetooth was turned off"));
                        }
                        break;
                    }
                    case UsbManager.ACTION_USB_DEVICE_ATTACHED:
                        notifyListeners("usbDevicesChanged", new JSObject());
                        break;
                    case UsbManager.ACTION_USB_DEVICE_DETACHED: {
                        UsbDevice device = IntentCompat.getParcelableExtra(intent, UsbManager.EXTRA_DEVICE, UsbDevice.class);
                        UsbDevice current;
                        synchronized (lock) {
                            current = usbDevice;
                        }
                        if (device != null && current != null && device.getDeviceName().equals(current.getDeviceName())) {
                            io.execute(() -> closeUsb("USB printer was unplugged"));
                        }
                        notifyListeners("usbDevicesChanged", new JSObject());
                        break;
                    }
                    default:
                        break;
                }
            }
        };

        IntentFilter systemFilter = new IntentFilter();
        systemFilter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
        systemFilter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
        systemFilter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        systemFilter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        ContextCompat.registerReceiver(getContext(), systemReceiver, systemFilter, ContextCompat.RECEIVER_EXPORTED);

        usbPermissionReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!ACTION_USB_PERMISSION.equals(intent.getAction())) return;

                PluginCall call;
                UsbDevice requested;
                synchronized (lock) {
                    call = pendingUsbCall;
                    requested = pendingUsbDevice;
                    pendingUsbCall = null;
                    pendingUsbDevice = null;
                }
                if (call == null) return;

                UsbDevice device = IntentCompat.getParcelableExtra(intent, UsbManager.EXTRA_DEVICE, UsbDevice.class);
                if (device == null) device = requested;
                boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);

                if (!granted || device == null) {
                    Log.w(TAG, "[PRINTER] USB permission denied");
                    call.reject("USB permission was denied.", "USB_PERMISSION_DENIED");
                    return;
                }
                final UsbDevice target = device;
                io.execute(() -> openUsb(call, target));
            }
        };
        ContextCompat.registerReceiver(
            getContext(),
            usbPermissionReceiver,
            new IntentFilter(ACTION_USB_PERMISSION),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    @Override
    protected void handleOnDestroy() {
        unregister(systemReceiver);
        unregister(usbPermissionReceiver);
        unregisterDiscovery();
        io.execute(() -> {
            closeBluetooth(null);
            closeUsb(null);
        });
        io.shutdown();
        super.handleOnDestroy();
    }

    private void unregister(BroadcastReceiver receiver) {
        if (receiver == null) return;
        try {
            getContext().unregisterReceiver(receiver);
        } catch (IllegalArgumentException ignored) {
            // already unregistered
        }
    }

    /* ------------------------------------------------------------------
       BLUETOOTH - STATE & PERMISSIONS
    ------------------------------------------------------------------ */

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager != null ? manager.getAdapter() : null;
    }

    /** Android 12+ needs "Nearby devices"; older versions use install-time BLUETOOTH permissions. */
    private boolean hasNearbyPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState(ALIAS_NEARBY) == PermissionState.GRANTED;
    }

    /** Only Android 11 and older need Location to discover (not to connect to) Bluetooth devices. */
    private boolean hasDiscoveryLocationPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S || getPermissionState(ALIAS_LOCATION) == PermissionState.GRANTED;
    }

    private static boolean isEnabled(BluetoothAdapter adapter) {
        try {
            return adapter != null && adapter.isEnabled();
        } catch (SecurityException e) {
            return false;
        }
    }

    @PluginMethod
    public void getBluetoothState(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        JSObject result = new JSObject();
        result.put("supported", adapter != null);
        result.put("enabled", isEnabled(adapter));
        result.put("permissionGranted", hasNearbyPermission());
        result.put("locationGranted", hasDiscoveryLocationPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void requestBluetoothPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (getPermissionState(ALIAS_NEARBY) != PermissionState.GRANTED) {
                requestPermissionForAlias(ALIAS_NEARBY, call, "bluetoothPermissionCallback");
                return;
            }
        } else if (getPermissionState(ALIAS_LOCATION) != PermissionState.GRANTED) {
            requestPermissionForAlias(ALIAS_LOCATION, call, "bluetoothPermissionCallback");
            return;
        }
        resolvePermissions(call);
    }

    @PermissionCallback
    private void bluetoothPermissionCallback(PluginCall call) {
        resolvePermissions(call);
    }

    private void resolvePermissions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasNearbyPermission());
        result.put("locationGranted", hasDiscoveryLocationPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void requestEnableBluetooth(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("Bluetooth is not available on this device.", "UNSUPPORTED");
            return;
        }
        if (isEnabled(adapter)) {
            resolveEnabled(call, true);
            return;
        }
        if (!hasNearbyPermission()) {
            call.reject("Bluetooth permission not granted.", "PERMISSION_DENIED");
            return;
        }
        try {
            startActivityForResult(call, new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), "enableBluetoothResult");
        } catch (SecurityException e) {
            call.reject("Bluetooth permission not granted.", "PERMISSION_DENIED");
        }
    }

    @ActivityCallback
    private void enableBluetoothResult(PluginCall call, ActivityResult result) {
        resolveEnabled(call, isEnabled(adapter()));
    }

    private static void resolveEnabled(PluginCall call, boolean enabled) {
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    /* ------------------------------------------------------------------
       BLUETOOTH - DEVICES
    ------------------------------------------------------------------ */

    private static String deviceName(BluetoothDevice device) {
        try {
            String name = device.getName();
            if (name != null && !name.trim().isEmpty()) return name.trim();
        } catch (SecurityException ignored) {
            // fall through to the address
        }
        return device.getAddress();
    }

    private static JSObject deviceToJson(BluetoothDevice device) {
        String name = deviceName(device);
        JSObject json = new JSObject();
        json.put("id", device.getAddress());
        json.put("address", device.getAddress());
        json.put("name", name);

        boolean paired = false;
        boolean imaging = false;
        String type = "unknown";
        try {
            paired = device.getBondState() == BluetoothDevice.BOND_BONDED;
            BluetoothClass bluetoothClass = device.getBluetoothClass();
            imaging = bluetoothClass != null && bluetoothClass.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING;
            int deviceType = device.getType();
            type = deviceType == BluetoothDevice.DEVICE_TYPE_CLASSIC
                ? "classic"
                : deviceType == BluetoothDevice.DEVICE_TYPE_DUAL
                ? "dual"
                : deviceType == BluetoothDevice.DEVICE_TYPE_LE ? "le" : "unknown";
        } catch (SecurityException ignored) {
            // leave defaults
        }

        String lower = name.toLowerCase(Locale.ROOT);
        boolean nameLooksLikePrinter = lower.matches(".*(print|pos|5890|5802|5805|thermal|receipt|rpp|mtp|xp-|gprinter|zjiang|pt-?2|pt-?3).*");

        json.put("paired", paired);
        json.put("likelyPrinter", imaging || nameLooksLikePrinter);
        json.put("bluetoothType", type);
        return json;
    }

    @PluginMethod
    public void listPairedDevices(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("Bluetooth is not available on this device.", "UNSUPPORTED");
            return;
        }
        if (!hasNearbyPermission()) {
            call.reject("Bluetooth permission not granted.", "PERMISSION_DENIED");
            return;
        }
        if (!isEnabled(adapter)) {
            call.reject("Bluetooth is off.", "BLUETOOTH_DISABLED");
            return;
        }

        JSArray devices = new JSArray();
        try {
            for (BluetoothDevice device : adapter.getBondedDevices()) {
                // Skip pure BLE bonds (earbuds, watches...) - receipt printers print over Classic/dual mode.
                JSObject json = deviceToJson(device);
                if ("le".equals(json.getString("bluetoothType"))) continue;
                devices.put(json);
            }
        } catch (SecurityException e) {
            call.reject("Bluetooth permission not granted.", "PERMISSION_DENIED");
            return;
        }

        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("Bluetooth is not available on this device.", "UNSUPPORTED");
            return;
        }
        if (!hasNearbyPermission()) {
            call.reject("Bluetooth permission not granted.", "PERMISSION_DENIED");
            return;
        }
        if (!hasDiscoveryLocationPermission()) {
            call.reject("Location permission is needed to search for Bluetooth printers.", "LOCATION_PERMISSION_DENIED");
            return;
        }
        if (!isEnabled(adapter)) {
            call.reject("Bluetooth is off.", "BLUETOOTH_DISABLED");
            return;
        }

        unregisterDiscovery();
        synchronized (discoveredAddresses) {
            discoveredAddresses.clear();
        }

        discoveryReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                    BluetoothDevice device = IntentCompat.getParcelableExtra(intent, BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
                    if (device == null) return;
                    boolean firstSighting;
                    synchronized (discoveredAddresses) {
                        firstSighting = discoveredAddresses.add(device.getAddress());
                    }
                    JSObject json = deviceToJson(device);
                    if ("le".equals(json.getString("bluetoothType"))) return;
                    if (firstSighting) Log.i(TAG,"[PRINTER] Device found: " + json.getString("name"));
                    notifyListeners("bluetoothDeviceFound", json);
                } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                    notifyListeners("bluetoothDiscoveryFinished", new JSObject());
                    unregisterDiscovery();
                }
            }
        };

        IntentFilter filter = new IntentFilter(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        ContextCompat.registerReceiver(getContext(), discoveryReceiver, filter, ContextCompat.RECEIVER_EXPORTED);

        try {
            if (adapter.isDiscovering()) adapter.cancelDiscovery();
            if (!adapter.startDiscovery()) {
                unregisterDiscovery();
                call.reject("Could not start searching for printers.", "SCAN_FAILED");
                return;
            }
            Log.i(TAG,"[PRINTER] Searching...");
            call.resolve();
        } catch (SecurityException e) {
            unregisterDiscovery();
            call.reject("Bluetooth permission not granted.", "PERMISSION_DENIED");
        }
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        try {
            if (adapter != null && adapter.isDiscovering()) adapter.cancelDiscovery();
        } catch (SecurityException ignored) {
            // nothing to stop without permission
        }
        unregisterDiscovery();
        call.resolve();
    }

    private void unregisterDiscovery() {
        BroadcastReceiver receiver = discoveryReceiver;
        discoveryReceiver = null;
        unregister(receiver);
    }

    /* ------------------------------------------------------------------
       BLUETOOTH - CONNECTION
    ------------------------------------------------------------------ */

    @PluginMethod
    public void connectBluetooth(PluginCall call) {
        String rawAddress = call.getString("address");
        String address = rawAddress == null ? null : rawAddress.trim().toUpperCase(Locale.ROOT);
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            call.reject("Invalid Bluetooth printer address.", "INVALID_ADDRESS");
            return;
        }

        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("Bluetooth is not available on this device.", "UNSUPPORTED");
            return;
        }
        if (!hasNearbyPermission()) {
            call.reject("Bluetooth permission not granted.", "PERMISSION_DENIED");
            return;
        }
        if (!isEnabled(adapter)) {
            call.reject("Bluetooth is off.", "BLUETOOTH_DISABLED");
            return;
        }

        io.execute(() -> {
            // One printer at a time.
            closeBluetooth(null);
            closeUsb(null);

            try {
                // Discovery slows RFCOMM connections down dramatically.
                adapter.cancelDiscovery();
            } catch (SecurityException ignored) {
                // not discovering
            }

            BluetoothDevice device = adapter.getRemoteDevice(address);
            Log.i(TAG,"[PRINTER] Connecting... " + address);

            BluetoothSocket socket = null;
            Exception lastError = null;

            // 1) secure SPP, 2) insecure SPP (many printers pair without authentication),
            // 3) raw RFCOMM channel 1 - the fallback some Chinese SPP stacks require.
            for (int attempt = 0; attempt < 3 && socket == null; attempt++) {
                BluetoothSocket candidate = null;
                try {
                    if (attempt == 0) {
                        candidate = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    } else if (attempt == 1) {
                        candidate = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                    } else {
                        Method method = device.getClass().getMethod("createRfcommSocket", int.class);
                        candidate = (BluetoothSocket) method.invoke(device, 1);
                    }
                    if (candidate == null) continue;
                    candidate.connect();
                    socket = candidate;
                } catch (SecurityException e) {
                    closeQuietly(candidate);
                    call.reject("Bluetooth permission not granted.", "PERMISSION_DENIED");
                    return;
                } catch (Exception e) {
                    lastError = e;
                    closeQuietly(candidate);
                    Log.w(TAG, "[PRINTER] Connect attempt " + (attempt + 1) + " failed: " + e.getMessage());
                }
            }

            if (socket == null) {
                Log.w(TAG, "[PRINTER] Connection failed", lastError);
                call.reject("Could not connect to the printer.", "CONNECT_FAILED");
                return;
            }

            try {
                OutputStream out = socket.getOutputStream();
                String name = deviceName(device);
                synchronized (lock) {
                    btSocket = socket;
                    btOut = out;
                    btAddress = address;
                    btName = name;
                }
                Log.i(TAG,"[PRINTER] Connected: " + name);
                call.resolve(connectionJson("bluetooth", address, name));
            } catch (IOException e) {
                closeQuietly(socket);
                Log.w(TAG, "[PRINTER] Connection failed", e);
                call.reject("Could not open the printer connection.", "CONNECT_FAILED");
            }
        });
    }

    private static void closeQuietly(BluetoothSocket socket) {
        if (socket == null) return;
        try {
            socket.close();
        } catch (IOException ignored) {
            // already closed
        }
    }

    /** Closes the Bluetooth link. A non-null reason means it was lost (not requested) and JS is notified. */
    private void closeBluetooth(String lostReason) {
        BluetoothSocket socket;
        String address;
        synchronized (lock) {
            socket = btSocket;
            address = btAddress;
            btSocket = null;
            btOut = null;
            btAddress = null;
            btName = null;
        }
        if (socket == null) return;

        closeQuietly(socket);
        if (lostReason == null) {
            Log.i(TAG,"[PRINTER] Disconnected");
            return;
        }
        Log.i(TAG,"[PRINTER] Disconnected: " + lostReason);
        JSObject event = new JSObject();
        event.put("type", "bluetooth");
        event.put("id", address);
        event.put("reason", lostReason);
        notifyListeners("connectionLost", event);
    }

    /* ------------------------------------------------------------------
       USB
    ------------------------------------------------------------------ */

    private UsbManager usbManager() {
        return (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    }

    private boolean usbHostSupported() {
        return getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_USB_HOST) && usbManager() != null;
    }

    private static String usbId(UsbDevice device) {
        return device.getVendorId() + ":" + device.getProductId();
    }

    private static String usbName(UsbDevice device) {
        String name = null;
        try {
            name = device.getProductName();
            if (name == null || name.trim().isEmpty()) name = device.getManufacturerName();
        } catch (SecurityException ignored) {
            // name not readable without permission on some versions
        }
        if (name == null || name.trim().isEmpty()) {
            return String.format(Locale.ROOT, "USB printer (%04X:%04X)", device.getVendorId(), device.getProductId());
        }
        return name.trim();
    }

    private static UsbEndpoint findBulkOut(UsbInterface usbInterface) {
        for (int i = 0; i < usbInterface.getEndpointCount(); i++) {
            UsbEndpoint endpoint = usbInterface.getEndpoint(i);
            if (endpoint.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK && endpoint.getDirection() == UsbConstants.USB_DIR_OUT) {
                return endpoint;
            }
        }
        return null;
    }

    /** Prefers a real USB printer-class interface; otherwise any vendor-specific interface with a bulk OUT endpoint. */
    private static UsbInterface findPrinterInterface(UsbDevice device) {
        UsbInterface fallback = null;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface candidate = device.getInterface(i);
            if (findBulkOut(candidate) == null) continue;
            int interfaceClass = candidate.getInterfaceClass();
            if (interfaceClass == UsbConstants.USB_CLASS_PRINTER) return candidate;
            boolean clearlyNotAPrinter = interfaceClass == UsbConstants.USB_CLASS_MASS_STORAGE
                || interfaceClass == UsbConstants.USB_CLASS_AUDIO
                || interfaceClass == UsbConstants.USB_CLASS_VIDEO
                || interfaceClass == UsbConstants.USB_CLASS_WIRELESS_CONTROLLER
                || interfaceClass == UsbConstants.USB_CLASS_HUB;
            if (!clearlyNotAPrinter && fallback == null) fallback = candidate;
        }
        return fallback;
    }

    @PluginMethod
    public void listUsbDevices(PluginCall call) {
        JSArray devices = new JSArray();
        boolean supported = usbHostSupported();

        if (supported) {
            UsbManager manager = usbManager();
            for (UsbDevice device : manager.getDeviceList().values()) {
                UsbInterface printerInterface = findPrinterInterface(device);
                if (printerInterface == null) continue;
                JSObject json = new JSObject();
                json.put("id", usbId(device));
                json.put("name", usbName(device));
                json.put("vendorId", device.getVendorId());
                json.put("productId", device.getProductId());
                json.put("hasPermission", manager.hasPermission(device));
                json.put("isPrinterClass", printerInterface.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER);
                devices.put(json);
            }
        }

        JSObject result = new JSObject();
        result.put("supported", supported);
        result.put("devices", devices);
        call.resolve(result);
    }

    @PluginMethod
    public void connectUsb(PluginCall call) {
        if (!usbHostSupported()) {
            call.reject("USB printers are not supported on this device.", "USB_UNSUPPORTED");
            return;
        }

        String id = call.getString("id", "");
        UsbManager manager = usbManager();
        UsbDevice device = null;
        for (UsbDevice candidate : manager.getDeviceList().values()) {
            boolean matches = usbId(candidate).equals(id) || candidate.getDeviceName().equals(id);
            if (matches && findPrinterInterface(candidate) != null) {
                device = candidate;
                break;
            }
        }

        if (device == null) {
            call.reject("USB printer not found.", "USB_NOT_FOUND");
            return;
        }

        if (manager.hasPermission(device)) {
            final UsbDevice target = device;
            io.execute(() -> openUsb(call, target));
            return;
        }

        synchronized (lock) {
            if (pendingUsbCall != null) {
                pendingUsbCall.reject("USB permission request was replaced by a newer one.", "USB_PERMISSION_DENIED");
            }
            pendingUsbCall = call;
            pendingUsbDevice = device;
        }

        // Explicit (package-scoped) intent; MUTABLE is required so the system can attach the
        // permission result extras, and Android 14 only allows that for explicit intents.
        Intent intent = new Intent(ACTION_USB_PERMISSION).setPackage(getContext().getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent permissionIntent = PendingIntent.getBroadcast(getContext(), 0, intent, flags);
        Log.i(TAG,"[PRINTER] Requesting USB permission for " + usbId(device));
        manager.requestPermission(device, permissionIntent);
    }

    private void openUsb(PluginCall call, UsbDevice device) {
        UsbInterface printerInterface = findPrinterInterface(device);
        UsbEndpoint endpoint = printerInterface == null ? null : findBulkOut(printerInterface);
        if (endpoint == null) {
            call.reject("This USB device can't receive print data.", "USB_OPEN_FAILED");
            return;
        }

        closeBluetooth(null);
        closeUsb(null);

        Log.i(TAG,"[PRINTER] Connecting... USB " + usbId(device));
        UsbDeviceConnection connection = usbManager().openDevice(device);
        if (connection == null) {
            call.reject("Could not open the USB printer.", "USB_OPEN_FAILED");
            return;
        }
        if (!connection.claimInterface(printerInterface, true)) {
            connection.close();
            call.reject("The USB printer is being used by another app.", "USB_OPEN_FAILED");
            return;
        }

        String name = usbName(device);
        synchronized (lock) {
            usbConnection = connection;
            usbInterface = printerInterface;
            usbOut = endpoint;
            usbDevice = device;
        }
        Log.i(TAG,"[PRINTER] Connected: " + name + " (USB)");
        call.resolve(connectionJson("usb", usbId(device), name));
    }

    /** Closes the USB link. A non-null reason means it was lost (not requested) and JS is notified. */
    private void closeUsb(String lostReason) {
        UsbDeviceConnection connection;
        UsbInterface claimed;
        UsbDevice device;
        synchronized (lock) {
            connection = usbConnection;
            claimed = usbInterface;
            device = usbDevice;
            usbConnection = null;
            usbInterface = null;
            usbOut = null;
            usbDevice = null;
        }
        if (connection == null) return;

        try {
            if (claimed != null) connection.releaseInterface(claimed);
        } catch (Exception ignored) {
            // device may already be gone
        }
        connection.close();

        if (lostReason == null) {
            Log.i(TAG,"[PRINTER] Disconnected (USB)");
            return;
        }
        Log.i(TAG,"[PRINTER] Disconnected: " + lostReason);
        JSObject event = new JSObject();
        event.put("type", "usb");
        event.put("id", device != null ? usbId(device) : null);
        event.put("reason", lostReason);
        notifyListeners("connectionLost", event);
    }

    /* ------------------------------------------------------------------
       PRINTING
    ------------------------------------------------------------------ */

    @PluginMethod
    public void write(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("No print data.", "INVALID_DATA");
            return;
        }

        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid print data.", "INVALID_DATA");
            return;
        }

        io.execute(() -> {
            OutputStream out;
            UsbDeviceConnection connection;
            UsbEndpoint endpoint;
            synchronized (lock) {
                out = btOut;
                connection = usbConnection;
                endpoint = usbOut;
            }

            if (out == null && connection == null) {
                call.reject("Printer is not connected.", "NOT_CONNECTED");
                return;
            }

            Log.i(TAG,"[PRINTER] Printing... " + bytes.length + " bytes");
            try {
                if (connection != null) {
                    int offset = 0;
                    while (offset < bytes.length) {
                        int length = Math.min(USB_CHUNK_SIZE, bytes.length - offset);
                        byte[] chunk = Arrays.copyOfRange(bytes, offset, offset + length);
                        int sent = connection.bulkTransfer(endpoint, chunk, length, USB_TIMEOUT_MS);
                        if (sent <= 0) throw new IOException("USB transfer failed");
                        offset += sent;
                    }
                } else {
                    for (int offset = 0; offset < bytes.length; offset += BT_CHUNK_SIZE) {
                        int length = Math.min(BT_CHUNK_SIZE, bytes.length - offset);
                        out.write(bytes, offset, length);
                        out.flush();
                        if (offset + length < bytes.length) Thread.sleep(BT_CHUNK_DELAY_MS);
                    }
                }
                Log.i(TAG,"[PRINTER] Print successful");
                call.resolve();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                Log.w(TAG, "[PRINTER] Print failed: interrupted");
                call.reject("Printing was interrupted.", "WRITE_FAILED");
            } catch (IOException e) {
                Log.w(TAG, "[PRINTER] Print failed: " + e.getMessage());
                // The link can't be trusted after a failed write - drop it so the next job reconnects cleanly.
                if (connection != null) closeUsb("Connection lost while printing");
                else closeBluetooth("Connection lost while printing");
                call.reject("The printer connection was lost while printing.", "WRITE_FAILED");
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        io.execute(() -> {
            closeBluetooth(null);
            closeUsb(null);
            call.resolve();
        });
    }

    @PluginMethod
    public void getConnectionState(PluginCall call) {
        synchronized (lock) {
            if (btSocket != null && btSocket.isConnected()) {
                call.resolve(connectionJson("bluetooth", btAddress, btName));
                return;
            }
            if (usbConnection != null && usbDevice != null) {
                call.resolve(connectionJson("usb", usbId(usbDevice), usbName(usbDevice)));
                return;
            }
        }
        JSObject result = new JSObject();
        result.put("connected", false);
        call.resolve(result);
    }

    private static JSObject connectionJson(String type, String id, String name) {
        JSObject result = new JSObject();
        result.put("connected", true);
        result.put("type", type);
        result.put("id", id);
        result.put("name", name);
        return result;
    }
}
