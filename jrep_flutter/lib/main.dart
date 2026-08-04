import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

import 'app_prefs.dart';
import 'firebase_options.dart';
import 'record_model.dart';
import 'screens/after_break_survey_view.dart';
import 'screens/after_work_survey_view.dart';
import 'screens/break_view.dart';
import 'screens/display_record_view.dart';
import 'screens/home_view.dart';
import 'screens/pre_survey/basic_information_view.dart';
import 'screens/pre_survey/free_answer_survey_view.dart';
import 'screens/pre_survey/mental_pre_survey_view.dart';
import 'screens/user_register_view.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  await AppPrefs.init();
  runApp(const JrepApp());
}

class JrepApp extends StatelessWidget {
  const JrepApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'JREPapp',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
        useMaterial3: true,
      ),
      home: const RootView(),
    );
  }
}

/// アプリ起動時に保存状態から画面を復元する（Swift: RootView）
/// 初回起動（被験者ID未設定）時は登録画面へ。
class RootView extends StatelessWidget {
  const RootView({super.key});

  SessionContext get _session {
    final sessionId = AppPrefs.sessionId;
    final startedAt = AppPrefs.sessionStartedAt;
    return SessionContext(
      subjectId: AppPrefs.subjectId,
      sessionId: sessionId.isEmpty ? const Uuid().v4() : sessionId,
      startedAt: startedAt > 0
          ? DateTime.fromMillisecondsSinceEpoch((startedAt * 1000).round())
          : DateTime.now(),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (AppPrefs.subjectId.isEmpty) {
      return const UserRegisterView();
    }

    final session = _session;
    switch (AppScreen.fromRaw(AppPrefs.currentScreen)) {
      case AppScreen.home:
        return const HomeView();
      case AppScreen.basicInfo:
        return BasicInformationView(
            vm: QuestionnaireViewModel(session: session));
      case AppScreen.mentalSurvey:
        return MentalPreSurveyView(
            vm: QuestionnaireViewModel(session: session));
      case AppScreen.freeSurvey:
        return FreeAnswerSurveyView(
            vm: QuestionnaireViewModel(session: session));
      case AppScreen.displayRecord:
        return DisplayRecordView(session: session);
      case AppScreen.afterWorkSurvey:
        return AfterWorkSurveyView(
          vm: AfterWorkSurveyViewModel(
            count: AppPrefs.afterBreakSurveyCount,
            session: session,
          ),
          session: session,
        );
      case AppScreen.breakView:
        return BreakView(session: session);
      case AppScreen.afterBreakSurvey:
        return AfterBreakSurveyView(
          vm: AfterBreakSurveyViewModel(
            count: AppPrefs.afterBreakSurveyCount + 1,
            session: session,
          ),
          session: session,
        );
    }
  }
}
