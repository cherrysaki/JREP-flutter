import 'package:flutter/material.dart';

import '../app_prefs.dart';
import '../record_model.dart';
import 'display_record_view.dart';
import 'widgets.dart';

/// 休憩後アンケート（Swift: AfterBreakSurveyView）
/// 送信後は2回目の作業（DisplayRecordView）へ。
class AfterBreakSurveyView extends StatefulWidget {
  final AfterBreakSurveyViewModel vm;
  final SessionContext session;
  const AfterBreakSurveyView(
      {super.key, required this.vm, required this.session});

  @override
  State<AfterBreakSurveyView> createState() => _AfterBreakSurveyViewState();
}

class _AfterBreakSurveyViewState extends State<AfterBreakSurveyView> {
  String _activity = '';
  int _recovery = 3;
  String _breakDuration = '';
  bool _isSending = false;

  Future<void> _submit() async {
    setState(() => _isSending = true);
    try {
      widget.vm.activity = _activity;
      widget.vm.recovery = _recovery;
      widget.vm.breakDuration = _breakDuration;

      await widget.vm.submit();

      AppPrefs.afterBreakSurveyCount = widget.vm.count;
      if (!mounted) return;
      setState(() => _isSending = false);

      // 作業開始時刻を保存、休憩タイマーをリセット
      AppPrefs.workStartedAt = DateTime.now().millisecondsSinceEpoch / 1000.0;
      AppPrefs.breakStartedAt = 0;
      AppPrefs.currentScreen = AppScreen.displayRecord.rawValue;
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => DisplayRecordView(session: widget.session),
        ),
      );
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
          title: const Text('休憩後アンケート'),
          centerTitle: true,
          automaticallyImplyLeading: false,
        ),
        body: ListView(
          children: [
            FormSection(
              header: '休憩時に何をしていましたか?',
              children: [
                TextFormField(
                  initialValue: _activity,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    hintText: '自由記述',
                    border: InputBorder.none,
                  ),
                  onChanged: (v) => _activity = v,
                ),
              ],
            ),
            FormSection(
              header: '回復度合い (5 段階評価)',
              children: [
                SegmentedRating(
                  value: _recovery,
                  onChanged: (v) => setState(() => _recovery = v),
                ),
              ],
            ),
            FormSection(
              header: '休憩時間',
              children: [
                TextFormField(
                  initialValue: _breakDuration,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    hintText: '例: 10分',
                    border: InputBorder.none,
                  ),
                  onChanged: (v) => _breakDuration = v,
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
