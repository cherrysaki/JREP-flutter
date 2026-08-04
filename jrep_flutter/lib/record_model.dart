import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

// ---------------------------------------------------------------------------
// 画面状態管理（Swift: AppScreen）
// ---------------------------------------------------------------------------
enum AppScreen {
  home('home'),
  basicInfo('basicInfo'),
  mentalSurvey('mentalSurvey'),
  freeSurvey('freeSurvey'),
  displayRecord('displayRecord'),
  afterWorkSurvey('afterWorkSurvey'),
  breakView('breakView'),
  afterBreakSurvey('afterBreakSurvey');

  const AppScreen(this.rawValue);
  final String rawValue;

  static AppScreen fromRaw(String raw) => AppScreen.values.firstWhere(
        (s) => s.rawValue == raw,
        orElse: () => AppScreen.home,
      );
}

// ---------------------------------------------------------------------------
// focusFlag ドキュメント（Swift: FocusFlag）
// ---------------------------------------------------------------------------
class FocusFlag {
  final String? id;
  final String source;
  final String subjectId;
  final DateTime timestamp;
  final bool? isFocused;

  FocusFlag({
    this.id,
    required this.source,
    required this.subjectId,
    required this.timestamp,
    this.isFocused,
  });

  static FocusFlag? fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    if (data == null) return null;
    final ts = data['timestamp'];
    if (ts is! Timestamp) return null;
    return FocusFlag(
      id: doc.id,
      source: data['source'] as String? ?? '',
      subjectId: data['subjectId'] as String? ?? '',
      timestamp: ts.toDate(),
      isFocused: data['isFocused'] as bool?,
    );
  }
}

// ---------------------------------------------------------------------------
// Firestore リアルタイム監視（Swift: FirestoreViewModel）
// ---------------------------------------------------------------------------
class FirestoreViewModel extends ChangeNotifier {
  bool showAlert = false;
  // デバッグ用
  bool? latestIsFocused;
  DateTime? latestTimestamp;
  String debugMessage = '';

  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _subscription;
  bool _hasDetectedFalse = false;

  void startListening({required String subjectId, required DateTime since}) {
    _hasDetectedFalse = false;
    showAlert = false;

    _subscription?.cancel();

    _subscription = FirebaseFirestore.instance
        .collection('focusFlag')
        // .where('subjectId', isEqualTo: subjectId)
        .where('timestamp', isGreaterThan: Timestamp.fromDate(since))
        .orderBy('timestamp')
        .snapshots()
        .listen((snapshot) {
      for (final change in snapshot.docChanges) {
        // 新規追加のみを見る（←重要）
        if (change.type != DocumentChangeType.added) continue;
        final record = FocusFlag.fromDoc(change.doc);
        if (record == null) continue;

        latestIsFocused = record.isFocused;
        latestTimestamp = record.timestamp;
        debugMessage = 'Received isFocused=${record.isFocused}';

        if (record.isFocused == false && !_hasDetectedFalse) {
          _hasDetectedFalse = true;
          showAlert = true;
          break;
        }
      }
      notifyListeners();
    }, onError: (error) {
      debugPrint('Firestore error: $error');
    });
  }

  void stopListening() {
    _subscription?.cancel();
    _subscription = null;
  }

  @override
  void dispose() {
    stopListening();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// 列挙型と補助
// ---------------------------------------------------------------------------
enum Gender {
  male('male', '男性'),
  female('female', '女性'),
  other('other', 'その他'),
  noAnswer('noAnswer', '回答しない');

  const Gender(this.rawValue, this.label);
  final String rawValue;
  final String label;
}

enum Handedness {
  right('right', '右'),
  left('left', '左'),
  both('both', '両方');

  const Handedness(this.rawValue, this.label);
  final String rawValue;
  final String label;
}

class SleepQualityLabel {
  static String label(int value) {
    switch (value) {
      case 1:
        return '非常に悪い';
      case 2:
        return '悪い';
      case 3:
        return 'ふつう';
      case 4:
        return '良い';
      case 5:
        return '非常に良い';
      default:
        return '';
    }
  }
}

// ---------------------------------------------------------------------------
// 実験セッション（Swift: SessionContext）
// ---------------------------------------------------------------------------
class SessionContext {
  final String subjectId;
  final String sessionId;
  final DateTime startedAt;

  const SessionContext({
    required this.subjectId,
    required this.sessionId,
    required this.startedAt,
  });

  static SessionContext newSession({required String subjectId}) {
    return SessionContext(
      subjectId: subjectId,
      sessionId: const Uuid().v4(),
      startedAt: DateTime.now(),
    );
  }
}

// ---------------------------------------------------------------------------
// 事前アンケートのモデル
// ---------------------------------------------------------------------------
class BasicInformation {
  String age = '';
  Gender gender = Gender.noAnswer;
  Handedness handedness = Handedness.right;
  String gradeOrAffiliation = '';
  String sleepDurationYesterdayHours = '';
  int sleepQuality = 3;
  String mealsAndTimes = '';
  String caffeineIntake = '';
  String alcoholYesterday = '';
  String currentDiseases = '';
  String medications = '';
  String exerciseHabit = '';
  String focusChronotype = '';
}

class MentalStateSurvey {
  int physicalCondition = 3;
  int sleepInsufficiency = 3;
  int stressLevel = 3;
  int fatigueAwareness = 3;
  int eyeStrain = 3;
  String physicalDiscomfort = '';
}

class FreeAnswerSurvey {
  String distractionFactors = '';
  String effectiveBreakStyle = '';
}

// ---------------------------------------------------------------------------
// 事前アンケート ViewModel（Swift: QuestionnaireViewModel）
// 3画面をまたいで入力を貯め、最後にまとめて送信する。
// ---------------------------------------------------------------------------
class QuestionnaireViewModel {
  final SessionContext session;

  final BasicInformation basic = BasicInformation();
  final MentalStateSurvey mental = MentalStateSurvey();
  final FreeAnswerSurvey free = FreeAnswerSurvey();

  QuestionnaireViewModel({required this.session});

  /// 最後にまとめて送信（Firestore）
  Future<void> submitAll() async {
    final db = FirebaseFirestore.instance;

    final payload = {
      'basic': {
        'age': basic.age,
        'gender': basic.gender.rawValue,
        'handedness': basic.handedness.rawValue,
        'gradeOrAffiliation': basic.gradeOrAffiliation,
        'sleepDurationYesterdayHours': basic.sleepDurationYesterdayHours,
        'sleepQuality': basic.sleepQuality,
        'mealsAndTimes': basic.mealsAndTimes,
        'caffeineIntake': basic.caffeineIntake,
        'alcoholYesterday': basic.alcoholYesterday,
        'currentDiseases': basic.currentDiseases,
        'medications': basic.medications,
        'exerciseHabit': basic.exerciseHabit,
        'focusChronotype': basic.focusChronotype,
      },
      'mental': {
        'physicalCondition': mental.physicalCondition,
        'sleepInsufficiency': mental.sleepInsufficiency,
        'stressLevel': mental.stressLevel,
        'fatigueAwareness': mental.fatigueAwareness,
        'eyeStrain': mental.eyeStrain,
        'physicalDiscomfort': mental.physicalDiscomfort,
      },
      'free': {
        'distractionFactors': free.distractionFactors,
        'effectiveBreakStyle': free.effectiveBreakStyle,
      },
    };

    await db.collection('preSurvey').add({
      'subjectId': session.subjectId,
      'sessionId': session.sessionId,
      'source': 'QuestionnaireBundle',
      'createdAt': FieldValue.serverTimestamp(),
      'payload': payload,
    });
  }
}

// ---------------------------------------------------------------------------
// 作業後アンケート ViewModel（Swift: AfterWorkSurveyViewModel）
// ---------------------------------------------------------------------------
class AfterWorkSurveyViewModel {
  final SessionContext session;
  int concentration = 3;
  int fatigue = 3;
  int comfort = 3;
  int count;

  AfterWorkSurveyViewModel({this.count = 1, required this.session});

  Future<void> submit() async {
    await FirebaseFirestore.instance.collection('afterWorkSurvey').add({
      'subjectId': session.subjectId,
      'sessionId': session.sessionId,
      'count': count,
      'concentration': concentration,
      'fatigue': fatigue,
      'comfort': comfort,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }
}

// ---------------------------------------------------------------------------
// 休憩後アンケート ViewModel（Swift: AfterBreakSurveyViewModel）
// ---------------------------------------------------------------------------
class AfterBreakSurveyViewModel {
  final SessionContext session;
  String activity = '';
  int recovery = 3;
  String breakDuration = '';
  int count;

  AfterBreakSurveyViewModel({this.count = 1, required this.session});

  Future<void> submit() async {
    await FirebaseFirestore.instance.collection('afterBreakSurvey').add({
      'subjectId': session.subjectId,
      'sessionId': session.sessionId,
      'count': count,
      'activity': activity,
      'recovery': recovery,
      'breakDuration': breakDuration,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }
}
