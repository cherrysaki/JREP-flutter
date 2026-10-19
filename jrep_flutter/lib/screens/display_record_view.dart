import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';

import '../app_prefs.dart';
import '../monitor/camera_monitor.dart';
import '../record_model.dart';
import 'after_work_survey_view.dart';
import 'widgets.dart';

/// 作業中画面（Swift: DisplayRecordView）
/// 経過時間の表示・90分で自動遷移・Firestore の集中度低下アラート
/// Web ではこの画面に入るとカメラの集中モニターが自動で起動する
class DisplayRecordView extends StatefulWidget {
  final SessionContext session;
  const DisplayRecordView({super.key, required this.session});

  @override
  State<DisplayRecordView> createState() => _DisplayRecordViewState();
}

class _DisplayRecordViewState extends State<DisplayRecordView> {
  final _vm = FirestoreViewModel();
  final _audioPlayer = AudioPlayer();

  late DateTime _appearDate;
  Duration _elapsed = Duration.zero;
  Timer? _timer;

  bool _hasAutoNavigated = false;
  bool _alertShown = false;
  bool _monitorActive = false;

  // 最大作業時間（秒）90分
  static const _maxWorkSeconds = 5400;

  @override
  void initState() {
    super.initState();

    // 保存された開始時刻がある場合はそれを使用、なければ現在時刻
    final workStartedAt = AppPrefs.workStartedAt;
    if (workStartedAt > 0) {
      _appearDate = DateTime.fromMillisecondsSinceEpoch(
          (workStartedAt * 1000).round());
    } else {
      _appearDate = DateTime.now();
      AppPrefs.workStartedAt = _appearDate.millisecondsSinceEpoch / 1000.0;
    }
    _hasAutoNavigated = false;

    debugPrint('被験者ID${AppPrefs.subjectId}');
    // Firestore リアルタイム監視開始
    _vm.addListener(_onFirestoreUpdate);
    _vm.startListening(subjectId: AppPrefs.subjectId, since: _appearDate);
    _startMonitor();

    // タイマー開始
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      setState(() {
        _elapsed = DateTime.now().difference(_appearDate);
      });

      // 90分経過で自動遷移
      if (_elapsed.inSeconds >= _maxWorkSeconds && !_hasAutoNavigated) {
        _hasAutoNavigated = true;
        _timer?.cancel();
        _timer = null;
        _goToAfterWorkSurvey();
      }
    });
  }

  // カメラの集中モニターを起動し、判定結果を focusFlag に書き込む
  Future<void> _startMonitor() async {
    if (!CameraMonitor.isSupported) return;
    _monitorActive = true;
    final subjectId = AppPrefs.subjectId;
    await CameraMonitor.start(
      subjectId: subjectId,
      onFocusStatus: (isFocused, isFinal) {
        FirestoreViewModel.saveFocusFlag(
          subjectId: subjectId,
          isFocused: isFocused,
          timestamp: DateTime.now(),
        ).catchError((Object e) => debugPrint('focusFlag write error: $e'));
      },
    );
  }

  // 作業終了時：監視を止めてから最終データを送信する（停止後のアラートを防ぐ）
  void _stopMonitor() {
    _timer?.cancel();
    _timer = null;
    _vm.stopListening();
    if (!_monitorActive) return;
    _monitorActive = false;
    unawaited(CameraMonitor.stop());
  }

  @override
  void dispose() {
    _stopMonitor();
    _timer?.cancel();
    _vm.removeListener(_onFirestoreUpdate);
    _vm.dispose();
    _audioPlayer.dispose();
    super.dispose();
  }

  void _onFirestoreUpdate() {
    if (_vm.showAlert && !_alertShown) {
      _alertShown = true;
      _showFocusAlert();
    }
  }

  // 集中度低下アラート（音 + ダイアログ）
  Future<void> _showFocusAlert() async {
    // アラート音を再生（iOSシステム音1005相当）
    unawaited(_audioPlayer.play(AssetSource('sounds/alert.wav')));

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Text('集中度が低下しています。\n休憩を取ってください。'),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(context).pop();
              _goToAfterWorkSurvey();
            },
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmEnd() async {
    final confirmed = await showConfirmDialog(
      context,
      title: '作業を終了しますか？',
      message: '作業後アンケートに進みます。',
      confirmLabel: '終了する',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    _timer?.cancel();
    _timer = null;
    _goToAfterWorkSurvey();
  }

  void _goToAfterWorkSurvey() {
    if (!mounted) return;
    _stopMonitor();
    AppPrefs.currentScreen = AppScreen.afterWorkSurvey.rawValue;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => AfterWorkSurveyView(
          vm: AfterWorkSurveyViewModel(
            count: AppPrefs.afterBreakSurveyCount,
            session: widget.session,
          ),
          session: widget.session,
        ),
      ),
    );
  }

  String _formatTime(Duration d) {
    final minutes = d.inSeconds ~/ 60;
    final seconds = d.inSeconds % 60;
    return '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final secondary = Theme.of(context).colorScheme.onSurfaceVariant;
    final withCamera = CameraMonitor.isSupported;

    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('作業'),
          centerTitle: true,
          automaticallyImplyLeading: false,
        ),
        body: GradientBackground(
          child: SafeArea(
            child: Column(
              children: [
                SizedBox(height: withCamera ? 8 : 20),
                if (!withCamera) ...[
                  Text('作業中',
                      style: Theme.of(context)
                          .textTheme
                          .headlineLarge
                          ?.copyWith(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                ],
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text(
                    '集中状態を監視しています。\n90分経過で自動的に評価へ進みます。',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: secondary),
                  ),
                ),
                SizedBox(height: withCamera ? 8 : 24),
                // タイマー表示カード
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Card(
                    child: Padding(
                      padding:
                          EdgeInsets.symmetric(vertical: withCamera ? 10 : 24),
                      child: SizedBox(
                        width: double.infinity,
                        child: Column(
                          children: [
                            Text('経過時間',
                                style: TextStyle(
                                    color: secondary,
                                    fontWeight: FontWeight.bold)),
                            SizedBox(height: withCamera ? 2 : 8),
                            Text(
                              _formatTime(_elapsed),
                              style: TextStyle(
                                fontSize: withCamera ? 36 : 64,
                                fontWeight: FontWeight.w600,
                                fontFeatures: const [
                                  FontFeature.tabularFigures()
                                ],
                              ),
                            ),
                            SizedBox(height: withCamera ? 4 : 8),
                            // 進捗（90分に対する割合）
                            Padding(
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 16),
                              child: LinearProgressIndicator(
                                value: (_elapsed.inSeconds / _maxWorkSeconds)
                                    .clamp(0.0, 1.0),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                if (withCamera) ...[
                  const SizedBox(height: 8),
                  // カメラの集中モニター（web/monitor/monitor.js）
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      child: CameraMonitor.view(),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text('被験者ID: ${AppPrefs.subjectId}',
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: secondary)),
                  const SizedBox(height: 8),
                ] else ...[
                  const SizedBox(height: 24),
                  const Text('集中状態を監視中…'),
                  const SizedBox(height: 4),
                  Text('被験者ID: ${AppPrefs.subjectId}',
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: secondary)),
                  const Spacer(),
                ],
                // 操作ボタン
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _confirmEnd,
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: const Text('終了する',
                          style: TextStyle(
                              fontSize: 18, fontWeight: FontWeight.bold)),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Text('指示がある時以外は押さないでください。',
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: secondary)),
                SizedBox(height: withCamera ? 12 : 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
