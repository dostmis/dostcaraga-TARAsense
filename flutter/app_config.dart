import 'package:flutter/foundation.dart';

class AppConfig {
  // Opt-in UI preview mode: bypasses real authentication and uses local
  // sample data when launched with --dart-define=UI_PREVIEW_MODE=true.
  static const bool uiPreviewMode = bool.fromEnvironment(
    'UI_PREVIEW_MODE',
    defaultValue: false,
  );

  static const String productionApiBaseUrl =
      'https://tarasense.dostcaraga.ph/api/mobile/v1';

  static String get apiBaseUrl => _normalizeBaseUrl(
    const String.fromEnvironment('API_BASE_URL', defaultValue: ''),
    fallback: _defaultApiBaseUrl(),
  );

  static String _defaultApiBaseUrl() {
    // Mobile should use the same deployed backend as the web application.
    // Use --dart-define=API_BASE_URL=... when you intentionally want a
    // different environment such as local development or staging.
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
      case TargetPlatform.iOS:
      case TargetPlatform.macOS:
      case TargetPlatform.windows:
      case TargetPlatform.linux:
      case TargetPlatform.fuchsia:
        return productionApiBaseUrl;
    }
  }

  static String _normalizeBaseUrl(String value, {required String fallback}) {
    final String trimmed = value.trim();
    final String selected = trimmed.isEmpty ? fallback : trimmed;
    return selected.endsWith('/')
        ? selected.substring(0, selected.length - 1)
        : selected;
  }
}
