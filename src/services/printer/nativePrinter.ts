import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/**
 * JS bridge to the app-local Android plugin
 * android/app/src/main/java/com/sellix/pos/printer/SellixPrinterPlugin.java
 * (Bluetooth Classic SPP + USB, fully offline).
 */

export type NativeBluetoothDevice = {
  id: string
  address: string
  name: string
  paired: boolean
  likelyPrinter: boolean
  bluetoothType: 'classic' | 'dual' | 'le' | 'unknown'
}

export type NativeUsbDevice = {
  id: string
  name: string
  vendorId: number
  productId: number
  hasPermission: boolean
  isPrinterClass: boolean
}

export type NativeConnection = {
  connected: boolean
  type?: 'bluetooth' | 'usb'
  id?: string
  name?: string
}

export type NativeConnectionLost = { type: 'bluetooth' | 'usb'; id: string | null; reason: string }

export interface SellixPrinterPlugin {
  getBluetoothState(): Promise<{ supported: boolean; enabled: boolean; permissionGranted: boolean; locationGranted: boolean }>
  requestBluetoothPermissions(): Promise<{ granted: boolean; locationGranted: boolean }>
  requestEnableBluetooth(): Promise<{ enabled: boolean }>
  listPairedDevices(): Promise<{ devices: NativeBluetoothDevice[] }>
  startDiscovery(): Promise<void>
  stopDiscovery(): Promise<void>
  connectBluetooth(options: { address: string }): Promise<NativeConnection>
  listUsbDevices(): Promise<{ supported: boolean; devices: NativeUsbDevice[] }>
  connectUsb(options: { id: string }): Promise<NativeConnection>
  /** Base64-encoded ESC/POS bytes. */
  write(options: { data: string }): Promise<void>
  disconnect(): Promise<void>
  getConnectionState(): Promise<NativeConnection>

  addListener(event: 'bluetoothDeviceFound', listener: (device: NativeBluetoothDevice) => void): Promise<PluginListenerHandle>
  addListener(event: 'bluetoothDiscoveryFinished', listener: () => void): Promise<PluginListenerHandle>
  addListener(event: 'connectionLost', listener: (event: NativeConnectionLost) => void): Promise<PluginListenerHandle>
  addListener(event: 'usbDevicesChanged', listener: () => void): Promise<PluginListenerHandle>
}

export const SellixPrinter = registerPlugin<SellixPrinterPlugin>('SellixPrinter')
