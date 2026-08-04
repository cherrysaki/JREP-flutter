import 'dart:async';

import 'package:flutter/material.dart';

import '../app_prefs.dart';
import '../record_model.dart';
import 'after_break_survey_view.dart';
import 'widgets.dart';

/// 休憩中画面（Swift: BreakView）
/// 最大20分のカウントダウン。時間切れまたはボタンで休憩後アンケートへ。
class BreakView extends StatefulWidget {
  final SessionContext session;
  const BreakView({super.key, required this.session});

  @override
  State<BreakView> createState() => _BreakViewState();
}

class _BreakViewState extends State<BreakView> {
  late DateTime _appearDate;
  Duration _elapsed = Duration.zero;
  Timer? _timer;
  bool _hasAutoNavigated = false;

  // 最大休憩時間（秒）
  static const _maxBreakSeconds = 1200;

  @override
  void initState() {
    super.initState();

    // 保存された開始時刻がある場合はそれを使用、なければ現在時刻
    final breakStartedAt = AppPrefs.breakStartedAt;
    if (breakStartedAt > 0) {
      _appearDate = DateTime.fromMillisecondsSinceEpoch(
          (breakStartedAt * 1000).round());
    } else {
      _appearDate = DateTime.now();
      AppPrefs.breakStartedAt = _appearDate.millisecondsSinceEpoch / 1000.0;
    }
    _hasAutoNavigated = false;

    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      setState(() {
        _elapsed = DateTime.now().difference(_appearDate);
      });
      final remaining = _maxBreakSeconds - _elapsed.inSeconds;
      if (remaining <= 0 && !_hasAutoNavigated) {
        _hasAutoNavigated = true;
        _timer?.cancel();
        _timer = null;
        _goToAfterBreakSurvey();
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _confirmEnd() async {
    final confirmed = await showConfirmDialog(
      context,
      title: '休憩を終了しますか？',
      message: 'アンケートに進みます。',
      confirmLabel: '終了する',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    _timer?.cancel();
    _timer = null;
    _goToAfterBreakSurvey();
  }

  void _goToAfterBreakSurvey() {
    if (!mounted) return;
    AppPrefs.currentScreen = AppScreen.afterBreakSurvey.rawValue;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => AfterBreakSurveyView(
          vm: AfterBreakSurveyViewModel(
            count: AppPrefs.afterBreakSurveyCount + 1,
            session: widget.session,
          ),
          session: widget.session,
        ),
      ),
    );
  }

  String _formatTime(int seconds) {
    final total = seconds < 0 ? 0 : seconds;
    final minutes = total ~/ 60;
    final secs = total % 60;
    return '${minutes.toString().padLeft(2, '0')}:${secs.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final secondary = Theme.of(context).colorScheme.onSurfaceVariant;
    final remaining = _maxBreakSeconds - _elapsed.inSeconds;

    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('休憩'),
          centerTitle: true,
          automaticallyImplyLeading: false,
        ),
        body: GradientBackground(
          child: SafeArea(
            child: Column(
              children: [
                const SizedBox(height: 20),
                Text('休憩中',
                    style: Theme.of(context)
                        .textTheme
                        .headlineLarge
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text(
                    '最大20分までの休憩です。時間になると自動で次へ進みます。',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: secondary),
                  ),
                ),
                const SizedBox(height: 24),
                // タイマー表示カード
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 24),
                      child: SizedBox(
                        width: double.infinity,
                        child: Column(
                          children: [
                            Text('残り時間',
                                style: TextStyle(
                                    color: secondary,
                                    fontWeight: FontWeight.bold)),
                            const SizedBox(height: 8),
                            Text(
                              _formatTime(remaining),
                              style: const TextStyle(
                                fontSize: 64,
                                fontWeight: FontWeight.w600,
                                fontFeatures: [FontFeature.tabularFigures()],
                              ),
                            ),
                            const SizedBox(height: 8),
                            // プログレス（経過割合）
                            Padding(
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 16),
                              child: LinearProgressIndicator(
                                value: (_elapsed.inSeconds / _maxBreakSeconds)
                                    .clamp(0.0, 1.0),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                const Spacer(),
                // 操作用のボタン
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _confirmEnd,
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: const Text('休憩を終了する',
                          style: TextStyle(
                              fontSize: 18, fontWeight: FontWeight.bold)),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Text('必要に応じて早めに終了できます。',
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: secondary)),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
