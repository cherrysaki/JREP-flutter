import 'package:flutter/material.dart';

import '../app_prefs.dart';
import 'home_view.dart';
import 'widgets.dart';

/// 被験者登録画面（Swift: UserRegisterView）
class UserRegisterView extends StatefulWidget {
  const UserRegisterView({super.key});

  @override
  State<UserRegisterView> createState() => _UserRegisterViewState();
}

class _UserRegisterViewState extends State<UserRegisterView> {
  final _inputController = TextEditingController();

  @override
  void dispose() {
    _inputController.dispose();
    super.dispose();
  }

  void _register() {
    AppPrefs.subjectId = _inputController.text;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const HomeView()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('被験者登録')),
      body: ListView(
        children: [
          FormSection(
            header: '被験者IDを入力してください',
            children: [
              TextField(
                controller: _inputController,
                autocorrect: false,
                decoration: const InputDecoration(
                  hintText: '被験者ID',
                  border: OutlineInputBorder(),
                ),
                onChanged: (_) => setState(() {}),
              ),
            ],
          ),
          FormSection(
            children: [
              FilledButton(
                onPressed: _inputController.text.isEmpty ? null : _register,
                child: const Text('登録'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
