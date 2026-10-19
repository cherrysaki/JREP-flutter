import 'dart:async';
import 'dart:js_interop';
import 'dart:ui_web' as ui_web;

import 'package:flutter/widgets.dart';
import 'package:web/web.dart' as web;

import 'camera_monitor.dart';

@JS('JrepMonitor')
external _JrepMonitor? get _jrepMonitor;

extension type _JrepMonitor._(JSObject _) implements JSObject {
  external void mount(web.HTMLElement container);
  external JSPromise<JSBoolean> start(_StartOptions opts);
  external JSPromise<JSAny?> stop();
  external JSPromise<JSBoolean> preload();
}

extension type _StartOptions._(JSObject _) implements JSObject {
  external factory _StartOptions({
    String subjectId,
    String gasUrl,
    JSFunction onFocusStatus,
  });
}

class CameraMonitor {
  static const _viewType = 'jrep-camera-monitor';
  static bool _registered = false;

  static bool get isSupported => true;

  /// monitor.js（type=module）の読み込み完了を待つ
  static Future<_JrepMonitor> _ready() async {
    final m = _jrepMonitor;
    if (m != null) return m;
    final c = Completer<void>();
    void onReady(web.Event _) {
      if (!c.isCompleted) c.complete();
    }

    final listener = onReady.toJS;
    web.window.addEventListener('jrep-monitor-ready', listener);
    try {
      // 取りこぼし対策で定期的にも確認する
      while (_jrepMonitor == null) {
        await Future.any([
          c.future,
          Future<void>.delayed(const Duration(milliseconds: 200)),
        ]);
      }
    } finally {
      web.window.removeEventListener('jrep-monitor-ready', listener);
    }
    return _jrepMonitor!;
  }

  static Future<bool> start({
    required String subjectId,
    required FocusStatusCallback onFocusStatus,
  }) async {
    final m = await _ready();
    final result = await m
        .start(_StartOptions(
          subjectId: subjectId,
          gasUrl: kGasUrl,
          onFocusStatus: ((bool isFocused, bool isFinal) =>
              onFocusStatus(isFocused, isFinal)).toJS,
        ))
        .toDart;
    return result.toDart;
  }

  static Future<void> stop() async {
    final m = _jrepMonitor;
    if (m == null) return;
    await m.stop().toDart;
  }

  /// カメラ映像と計測値のパネル（DOM は monitor.js が描画する）
  static Widget view() {
    if (!_registered) {
      _registered = true;
      ui_web.platformViewRegistry.registerViewFactory(_viewType, (int _) {
        final container = web.HTMLDivElement()
          ..style.width = '100%'
          ..style.height = '100%';
        _ready().then((m) => m.mount(container));
        return container;
      });
    }
    return const HtmlElementView(viewType: _viewType);
  }
}
