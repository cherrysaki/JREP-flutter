import 'package:flutter/widgets.dart';

import 'camera_monitor.dart';

class CameraMonitor {
  static bool get isSupported => false;

  static Future<bool> start({
    required String subjectId,
    required FocusStatusCallback onFocusStatus,
  }) async =>
      false;

  static Future<void> stop() async {}

  static Widget view() => const SizedBox.shrink();
}
