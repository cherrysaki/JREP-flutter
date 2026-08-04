import 'package:flutter/material.dart';

import '../../app_prefs.dart';
import '../../record_model.dart';
import '../home_view.dart';
import '../widgets.dart';
import 'mental_pre_survey_view.dart';

/// 事前アンケート：基本情報（Swift: BasicInformationView）
class BasicInformationView extends StatefulWidget {
  final QuestionnaireViewModel vm;
  const BasicInformationView({super.key, required this.vm});

  @override
  State<BasicInformationView> createState() => _BasicInformationViewState();
}

class _BasicInformationViewState extends State<BasicInformationView> {
  QuestionnaireViewModel get vm => widget.vm;

  // 必須チェック（年齢・睡眠の質）
  bool get _isInputValid =>
      vm.basic.age.trim().isNotEmpty &&
      vm.basic.sleepQuality >= 1 &&
      vm.basic.sleepQuality <= 5;

  Future<void> _onNext() async {
    if (!_isInputValid) {
      await showOkDialog(
        context,
        title: '入力に不足があります',
        message: '年齢と睡眠の質（1〜5）を入力してください。',
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

    AppPrefs.currentScreen = AppScreen.mentalSurvey.rawValue;
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => MentalPreSurveyView(vm: vm)),
    );
  }

  void _cancel() {
    AppPrefs.currentScreen = AppScreen.home.rawValue;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const HomeView()),
      (route) => false,
    );
  }

  Widget _textField({
    required String hint,
    required String initialValue,
    required ValueChanged<String> onChanged,
    int maxLines = 1,
  }) {
    return TextFormField(
      initialValue: initialValue,
      autocorrect: false,
      maxLines: maxLines,
      minLines: 1,
      decoration: InputDecoration(
        labelText: hint,
        border: InputBorder.none,
      ),
      onChanged: (v) {
        onChanged(v);
        setState(() {});
      },
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
          leading: TextButton.icon(
            onPressed: _cancel,
            icon: const Icon(Icons.chevron_left),
            label: const Text('Cancel'),
          ),
          leadingWidth: 120,
        ),
        body: ListView(
          children: [
            FormSection(
              header: '基本情報',
              children: [
                _textField(
                  hint: '年齢',
                  initialValue: vm.basic.age,
                  onChanged: (v) => vm.basic.age = v,
                ),
                Row(
                  children: [
                    const Expanded(child: Text('性別')),
                    DropdownButton<Gender>(
                      value: vm.basic.gender,
                      items: [
                        for (final g in Gender.values)
                          DropdownMenuItem(value: g, child: Text(g.label)),
                      ],
                      onChanged: (g) =>
                          setState(() => vm.basic.gender = g ?? vm.basic.gender),
                    ),
                  ],
                ),
                Row(
                  children: [
                    const Expanded(child: Text('利き手')),
                    DropdownButton<Handedness>(
                      value: vm.basic.handedness,
                      items: [
                        for (final h in Handedness.values)
                          DropdownMenuItem(value: h, child: Text(h.label)),
                      ],
                      onChanged: (h) => setState(
                          () => vm.basic.handedness = h ?? vm.basic.handedness),
                    ),
                  ],
                ),
                _textField(
                  hint: '学年・所属',
                  initialValue: vm.basic.gradeOrAffiliation,
                  onChanged: (v) => vm.basic.gradeOrAffiliation = v,
                ),
              ],
            ),
            FormSection(
              header: '睡眠',
              children: [
                _textField(
                  hint: '前日の睡眠時間',
                  initialValue: vm.basic.sleepDurationYesterdayHours,
                  onChanged: (v) => vm.basic.sleepDurationYesterdayHours = v,
                ),
                RatingRow(
                  title: '睡眠の質（主観）',
                  value: vm.basic.sleepQuality,
                  onChanged: (v) => setState(() => vm.basic.sleepQuality = v),
                  description: '1=非常に悪い〜5=非常に良い',
                ),
              ],
            ),
            FormSection(
              header: '食事・嗜好品',
              children: [
                _textField(
                  hint: 'その日の食事と時刻',
                  initialValue: vm.basic.mealsAndTimes,
                  onChanged: (v) => vm.basic.mealsAndTimes = v,
                  maxLines: 4,
                ),
                _textField(
                  hint: 'カフェイン摂取（摂取量・時刻など）',
                  initialValue: vm.basic.caffeineIntake,
                  onChanged: (v) => vm.basic.caffeineIntake = v,
                  maxLines: 3,
                ),
                _textField(
                  hint: '前日の飲酒の有無・量',
                  initialValue: vm.basic.alcoholYesterday,
                  onChanged: (v) => vm.basic.alcoholYesterday = v,
                  maxLines: 3,
                ),
              ],
            ),
            FormSection(
              header: '健康状態',
              children: [
                _textField(
                  hint: '今治療中の疾患',
                  initialValue: vm.basic.currentDiseases,
                  onChanged: (v) => vm.basic.currentDiseases = v,
                  maxLines: 3,
                ),
                _textField(
                  hint: '服用中の薬',
                  initialValue: vm.basic.medications,
                  onChanged: (v) => vm.basic.medications = v,
                  maxLines: 3,
                ),
              ],
            ),
            FormSection(
              header: '生活習慣・傾向',
              children: [
                _textField(
                  hint: '運動習慣（週○回、1回あたり○分 など）',
                  initialValue: vm.basic.exerciseHabit,
                  onChanged: (v) => vm.basic.exerciseHabit = v,
                  maxLines: 3,
                ),
                _textField(
                  hint: '自己申告の集中傾向（朝型/夜型/一定でない など）',
                  initialValue: vm.basic.focusChronotype,
                  onChanged: (v) => vm.basic.focusChronotype = v,
                ),
              ],
            ),
            FormSection(
              footer: _isInputValid
                  ? null
                  : const Text('年齢と睡眠の質を入力してください。その他の項目は自由記述です。'),
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
