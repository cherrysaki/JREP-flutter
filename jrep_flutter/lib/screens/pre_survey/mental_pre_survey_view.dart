import 'package:flutter/material.dart';

import '../../app_prefs.dart';
import '../../record_model.dart';
import '../widgets.dart';
import 'free_answer_survey_view.dart';

/// 事前アンケート：心身の状態（Swift: MentalPreSurveyView）
class MentalPreSurveyView extends StatefulWidget {
  final QuestionnaireViewModel vm;
  const MentalPreSurveyView({super.key, required this.vm});

  @override
  State<MentalPreSurveyView> createState() => _MentalPreSurveyViewState();
}

class _MentalPreSurveyViewState extends State<MentalPreSurveyView> {
  QuestionnaireViewModel get vm => widget.vm;

  static const _conditionDesc = '1=非常に悪い　5=非常に良い';
  static const _degreeDesc = '1=全く感じない　5=非常に感じる';

  Future<void> _onNext() async {
    final confirmed = await showConfirmDialog(
      context,
      title: '入力内容を送信しますか？',
      message: '送信後に編集できない場合があります。内容をご確認ください。',
      confirmLabel: '送信',
      destructive: true,
    );
    if (!confirmed || !mounted) return;

    AppPrefs.currentScreen = AppScreen.freeSurvey.rawValue;
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => FreeAnswerSurveyView(vm: vm)),
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
              header: '心身の状態',
              children: [
                RatingRow(
                  title: '現在の体調',
                  value: vm.mental.physicalCondition,
                  onChanged: (v) =>
                      setState(() => vm.mental.physicalCondition = v),
                  description: _conditionDesc,
                ),
                RatingRow(
                  title: '睡眠不足感',
                  value: vm.mental.sleepInsufficiency,
                  onChanged: (v) =>
                      setState(() => vm.mental.sleepInsufficiency = v),
                  description: _degreeDesc,
                ),
                RatingRow(
                  title: 'ストレス状態',
                  value: vm.mental.stressLevel,
                  onChanged: (v) => setState(() => vm.mental.stressLevel = v),
                  description: _degreeDesc,
                ),
                RatingRow(
                  title: '疲労自覚度',
                  value: vm.mental.fatigueAwareness,
                  onChanged: (v) =>
                      setState(() => vm.mental.fatigueAwareness = v),
                  description: _degreeDesc,
                ),
                RatingRow(
                  title: '眼精疲労の程度',
                  value: vm.mental.eyeStrain,
                  onChanged: (v) => setState(() => vm.mental.eyeStrain = v),
                  description: _degreeDesc,
                ),
              ],
            ),
            FormSection(
              header: '身体的不調',
              children: [
                TextFormField(
                  initialValue: vm.mental.physicalDiscomfort,
                  autocorrect: false,
                  minLines: 1,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: '頭痛・肩こりなど（有無/自由記述）',
                    border: InputBorder.none,
                  ),
                  onChanged: (v) => vm.mental.physicalDiscomfort = v,
                ),
              ],
            ),
            FormSection(
              children: [
                FilledButton(
                  onPressed: _onNext,
                  child: const Text('次へ'),
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
