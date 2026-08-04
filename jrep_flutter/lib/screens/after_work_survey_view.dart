import 'package:flutter/material.dart';

import '../app_prefs.dart';
import '../record_model.dart';
import 'break_view.dart';
import 'home_view.dart';
import 'widgets.dart';

/// 作業後アンケート（Swift: AfterWorkSurveyView）
/// 送信後：1回目（count=0）は休憩へ、2回目（count=1）は実験終了→ホームへ。
class AfterWorkSurveyView extends StatefulWidget {
  final AfterWorkSurveyViewModel vm;
  final SessionContext session;
  const AfterWorkSurveyView({super.key, required this.vm, required this.session});

  @override
  State<AfterWorkSurveyView> createState() => _AfterWorkSurveyViewState();
}

class _AfterWorkSurveyViewState extends State<AfterWorkSurveyView> {
  int _concentration = 3;
  int _fatigue = 3;
  int _comfort = 3;
  bool _isSending = false;

  Future<void> _submit() async {
    setState(() => _isSending = true);
    try {
      widget.vm.concentration = _concentration;
      widget.vm.fatigue = _fatigue;
      widget.vm.comfort = _comfort;

      await widget.vm.submit();

      final sendCount = widget.vm.count;
      AppPrefs.afterWorkSurveyCount = sendCount;
      if (!mounted) return;
      setState(() => _isSending = false);

      if (sendCount == 1) {
        // 2回目の作業後 → 終了アラートを表示してからホームへ
        await showOkDialog(
          context,
          title: '実験終了',
          message: 'お疲れ様でした。\n実験は終了です。',
        );
        if (!mounted) return;
        AppPrefs.currentScreen = AppScreen.home.rawValue;
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const HomeView()),
          (route) => false,
        );
      } else {
        // 1回目の作業後（count=0）→ 休憩へ
        AppPrefs.breakStartedAt =
            DateTime.now().millisecondsSinceEpoch / 1000.0;
        AppPrefs.workStartedAt = 0; // 作業タイマーをリセット
        AppPrefs.currentScreen = AppScreen.breakView.rawValue;
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => BreakView(session: widget.session)),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSending = false);
        await showOkDialog(context, title: '送信エラー', message: '$e');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('作業後アンケート'),
          centerTitle: true,
          automaticallyImplyLeading: false,
        ),
        body: ListView(
          children: [
            FormSection(
              header: '集中度 (5 段階評価)',
              children: [
                SegmentedRating(
                  value: _concentration,
                  onChanged: (v) => setState(() => _concentration = v),
                ),
              ],
            ),
            FormSection(
              header: '疲労感 (5 段階評価)',
              children: [
                SegmentedRating(
                  value: _fatigue,
                  onChanged: (v) => setState(() => _fatigue = v),
                ),
              ],
            ),
            FormSection(
              header: '快適度 (5 段階評価)',
              children: [
                SegmentedRating(
                  value: _comfort,
                  onChanged: (v) => setState(() => _comfort = v),
                ),
              ],
            ),
            FormSection(
              children: [
                FilledButton(
                  onPressed: _isSending ? null : _submit,
                  child: _isSending
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('送信'),
                ),
              ],
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}
