// 集中モニター（カメラ計測）の Flutter 側インターフェース。
// 実体は web/monitor/monitor.js（all2.py のブラウザ移植版）で、Web 以外では何もしない。
export 'camera_monitor_stub.dart'
    if (dart.library.js_interop) 'camera_monitor_web.dart';

/// all2.py の GAS_URL と同じ送信先（スプレッドシート FocusStatus / Face / Vitals）
const String kGasUrl =
    'https://script.google.com/macros/s/AKfycbyGJFZh7AWT2iZyngQ89d8_zcZqndLFlXsmpF9_FnEl7YOe1c9nE6V-QsYj66TGNXU4gg/exec';

/// 60秒ごと（と停止時）に呼ばれる。isFocused は all2.py の FocusStatus と同じ判定。
typedef FocusStatusCallback = void Function(bool isFocused, bool isFinal);
