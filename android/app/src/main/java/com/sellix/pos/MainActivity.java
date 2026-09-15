package com.sellix.pos;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;
import com.sellix.pos.printer.SellixPrinterPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins must be registered before the bridge is created.
        registerPlugin(SellixPrinterPlugin.class);

        super.onCreate(savedInstanceState);

        WebSettings settings = getBridge()
                .getWebView()
                .getSettings();

        settings.setMixedContentMode(
                WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        );
    }
}
