import 'package:flutter/material.dart';

import '../app_prefs.dart';
import '../record_model.dart';
import 'pre_survey/basic_information_view.dart';
import 'user_register_view.dart';
import 'widgets.dart';

/// ホーム画面（Swift: HomeView）
class HomeView extends StatefulWidget {
  const HomeView({super.key});

  @override
  State<HomeView> createState() => _HomeViewState();
}

class _HomeViewState extends State<HomeView> {
  @override
  void initState() {
    super.initState();
    // HomeViewに戻ったら必ずリセット（Swift: onAppear）
    AppPrefs.afterBreakSurveyCount = 0;
    AppPrefs.afterWorkSurveyCount = 0;
    AppPrefs.currentScreen = AppScreen.home.rawValue;
    AppPrefs.sessionId = '';
    AppPrefs.sessionStartedAt = 0;
    AppPrefs.removeWorkStartedAt();
    AppPrefs.removeBreakStartedAt();
  }

  Future<void> _startExperiment() async {
    final confirmed = await showConfirmDialog(
      context,
      title: '実験を開始しますか？',
      message: '事前アンケートに進みます。',
      confirmLabel: '開始する',
    );
    if (!confirmed || !mounted) return;

    final newSession = SessionContext.newSession(subjectId: AppPrefs.subjectId);
    final vm = QuestionnaireViewModel(session: newSession);
    // セッション情報を永続化
    AppPrefs.sessionId = newSession.sessionId;
    AppPrefs.sessionStartedAt =
        newSession.startedAt.millisecondsSinceEpoch / 1000.0;
    AppPrefs.currentScreen = AppScreen.basicInfo.rawValue;

    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => BasicInformationView(vm: vm)),
    );
  }

  Future<void> _logout() async {
    final confirmed = await showConfirmDialog(
      context,
      title: 'ログアウトしますか？',
      message: '被験者登録画面に戻ります。',
      confirmLabel: 'ログアウト',
      destructive: true,
    );
    if (!confirmed || !mounted) return;

    // 保存値をリセット
    AppPrefs.subjectId = '';
    AppPrefs.afterBreakSurveyCount = 0;
    AppPrefs.afterWorkSurveyCount = 0;
    AppPrefs.currentScreen = AppScreen.home.rawValue;
    AppPrefs.sessionId = '';
    AppPrefs.sessionStartedAt = 0;
    // タイマー関連もリセット
    AppPrefs.removeWorkStartedAt();
    AppPrefs.removeBreakStartedAt();

    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const UserRegisterView()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final subjectId = AppPrefs.subjectId;
    final secondary = Theme.of(context).colorScheme.onSurfaceVariant;

    return Scaffold(
      appBar: AppBar(
        title: const Text('ホーム'),
        centerTitle: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: _logout,
          ),
        ],
      ),
      body: GradientBackground(
        child: SafeArea(
          child: Column(
            children: [
              const SizedBox(height: 20),
              Text('ホーム',
                  style: Theme.of(context)
                      .textTheme
                      .headlineLarge
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  '被験者IDを確認し、実験を開始してください。',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: secondary),
                ),
              ),
              const SizedBox(height: 24),
              // プロフィール風カード
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 24),
                    child: SizedBox(
                      width: double.infinity,
                      child: Column(
                        children: [
                          Icon(Icons.account_circle,
                              size: 72,
                              color: Theme.of(context).colorScheme.primary),
                          const SizedBox(height: 12),
                          Text('被験者ID',
                              style: TextStyle(
                                  color: secondary,
                                  fontWeight: FontWeight.bold)),
                          const SizedBox(height: 4),
                          Text(
                            subjectId.isEmpty ? '未設定' : subjectId,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context)
                                .textTheme
                                .headlineMedium
                                ?.copyWith(fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              const Spacer(),
              // 実験開始ボタン
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _startExperiment,
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                    ),
                    child: const Text('実験開始',
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.bold)),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text('開始後は事前アンケートに進みます。',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: secondary)),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}
