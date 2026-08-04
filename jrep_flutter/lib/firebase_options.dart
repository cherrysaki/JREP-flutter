import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

/// 既存の GoogleService-Info.plist (iOSアプリ用) の値をもとに構成。
/// Web で接続エラーが出る場合は、Firebaseコンソールで Web アプリを追加登録し、
/// ここの web 設定（特に appId / authDomain）を差し替えること。
class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      return web;
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions are not supported for this platform.',
        );
    }
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyBAvej-5rAbC9WcBw1QzFmhOctaFKYGuS8',
    appId: '1:587546223620:ios:ba7039a0ec8c7b0be30151',
    messagingSenderId: '587546223620',
    projectId: 'jrep-be25b',
    authDomain: 'jrep-be25b.firebaseapp.com',
    storageBucket: 'jrep-be25b.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyBAvej-5rAbC9WcBw1QzFmhOctaFKYGuS8',
    appId: '1:587546223620:ios:ba7039a0ec8c7b0be30151',
    messagingSenderId: '587546223620',
    projectId: 'jrep-be25b',
    storageBucket: 'jrep-be25b.firebasestorage.app',
    iosBundleId: 'app.kambayashi.yukke.JREPapp',
  );
}
