import 'package:flutter/material.dart';

import '../../app_prefs.dart';
import '../../record_model.dart';
import '../display_record_view.dart';
import '../widgets.dart';

/// 事前アンケート：自由記述（Swift: FreeAnswerSurveyView）
class FreeAnswerSurveyView extends StatefulWidget {
  final QuestionnaireViewModel vm;
  const FreeAnswerSurveyView({super.key, required this.vm});

  @override
  State<FreeAnswerSurveyView> createState() => _FreeAnswerSurveyViewState();
}

class _FreeAnswerSurveyViewState extends State<FreeAnswerSurveyView> {
  QuestionnaireViewModel get vm => widget.vm;

  bool _isSending = false;

  bool get _isInputValid =>
      vm.free.distractionFactors.trim().isNotEmpty &&
      vm.free.effectiveBreakStyle.trim().isNotEmpty;

  Future<void> _onSubmit() async {
    if (!_isInputValid) {
      await showOkDialog(
        context,
        title: '入力に不足があります',
        message: '2つの質問に回答してください。',
      );
      return;
    }
    final confirmed = await showConfirmDialog(
      context,
      title: '入力内容を送信しますか？',
      message: '送信後に編集できない場合があります。内容をご確認ください。',
      confirmLabel: '送信',
      destructive: true,
    );
    if (!confirmed || !mounted) return;

    setState(() => _isSending = true);
    try {
      await vm.submitAll();
      if (!mounted) return;
      // 作業開始時刻を保存
      AppPrefs.workStartedAt = DateTime.now().millisecondsSinceEpoch / 1000.0;
      AppPrefs.currentScreen = AppScreen.displayRecord.rawValue;
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => DisplayRecordView(session: vm.session),
        ),
      );
    } catch (e) {
      if (mounted) {
        await showOkDialog(context, title: '送信エラー', message: '$e');
      }
    } finally {
      if (mounted) setState(() => _isSending = false);
    }
  }

  Widget _answerField({
    required String question,
    required String hint,
    required String initialValue,
    required ValueChanged<String> onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(question,
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 8),
        TextFormField(
          initialValue: initialValue,
          autocorrect: false,
          minLines: 5,
          maxLines: 10,
          decoration: InputDecoration(
            hintText: hint,
            border: const OutlineInputBorder(),
          ),
          onChanged: (v) {
            onChanged(v);
            setState(() {});
          },
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('事前アンケート'),
          centerTitle: true,
          automaticallyImplyLeading: false,
        ),
        body: ListView(
          children: [
            FormSection(
              header: '自由記述アンケート',
              children: [
                _answerField(
                  question: '現在の集中を妨げる要因があれば教えてください。',
                  hint: '例：周囲の騒音、スマートフォン通知、睡眠不足 など',
                  initialValue: vm.free.distractionFactors,
                  onChanged: (v) => vm.free.distractionFactors = v,
                ),
                _answerField(
                  question: 'どのような休憩の取り方が最も効果的だと感じますか?',
                  hint: '例：短い頻繁な休憩、散歩、ストレッチ、目を閉じる、ポモドーロ など',
                  initialValue: vm.free.effectiveBreakStyle,
                  onChanged: (v) => vm.free.effectiveBreakStyle = v,
                ),
              ],
            ),
            FormSection(
              footer: _isInputValid ? null : const Text('両方の設問に回答してください。'),
              children: [
                FilledButton(
                  onPressed: _isSending ? null : _onSubmit,
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
