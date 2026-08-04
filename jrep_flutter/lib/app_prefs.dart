import 'package:shared_preferences/shared_preferences.dart';

/// SwiftUI の @AppStorage / UserDefaults に相当する永続化ラッパー。
/// キー名は Swift 版と同一。
class AppPrefs {
  static late SharedPreferences _prefs;

  static Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  static String get subjectId => _prefs.getString('subjectID') ?? '';
  static set subjectId(String v) => _prefs.setString('subjectID', v);

  static String get currentScreen => _prefs.getString('currentScreen') ?? 'home';
  static set currentScreen(String v) => _prefs.setString('currentScreen', v);

  static String get sessionId => _prefs.getString('sessionId') ?? '';
  static set sessionId(String v) => _prefs.setString('sessionId', v);

  static double get sessionStartedAt =>
      _prefs.getDouble('sessionStartedAt') ?? 0;
  static set sessionStartedAt(double v) =>
      _prefs.setDouble('sessionStartedAt', v);

  static int get afterBreakSurveyCount =>
      _prefs.getInt('afterBreakSurveyCount') ?? 0;
  static set afterBreakSurveyCount(int v) =>
      _prefs.setInt('afterBreakSurveyCount', v);

  static int get afterWorkSurveyCount =>
      _prefs.getInt('afterWorkSurveyCount') ?? 0;
  static set afterWorkSurveyCount(int v) =>
      _prefs.setInt('afterWorkSurveyCount', v);

  static double get workStartedAt => _prefs.getDouble('workStartedAt') ?? 0;
  static set workStartedAt(double v) => _prefs.setDouble('workStartedAt', v);

  static double get breakStartedAt => _prefs.getDouble('breakStartedAt') ?? 0;
  static set breakStartedAt(double v) => _prefs.setDouble('breakStartedAt', v);

  static void removeWorkStartedAt() => _prefs.remove('workStartedAt');
  static void removeBreakStartedAt() => _prefs.remove('breakStartedAt');
}
