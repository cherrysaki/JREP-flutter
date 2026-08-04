import 'package:flutter/material.dart';

/// SwiftUI の Form Section 風のグループ表示
class FormSection extends StatelessWidget {
  final String? header;
  final Widget? footer;
  final List<Widget> children;

  const FormSection({super.key, this.header, this.footer, required this.children});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (header != null)
            Padding(
              padding: const EdgeInsets.only(left: 8, bottom: 6),
              child: Text(
                header!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
            ),
          Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var i = 0; i < children.length; i++) ...[
                    if (i > 0) const Divider(height: 1),
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: children[i],
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (footer != null)
            Padding(
              padding: const EdgeInsets.only(left: 8, top: 6),
              child: DefaultTextStyle(
                style: Theme.of(context).textTheme.bodySmall!.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                child: footer!,
              ),
            ),
        ],
      ),
    );
  }
}

/// 1〜5 のセグメント選択（SwiftUI の segmented Picker 相当）
class SegmentedRating extends StatelessWidget {
  final int value;
  final ValueChanged<int> onChanged;
  final String Function(int)? labelBuilder;

  const SegmentedRating({
    super.key,
    required this.value,
    required this.onChanged,
    this.labelBuilder,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: SegmentedButton<int>(
        segments: [
          for (var v = 1; v <= 5; v++)
            ButtonSegment(
              value: v,
              label: Text(
                labelBuilder?.call(v) ?? '$v',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12),
              ),
            ),
        ],
        selected: {value},
        showSelectedIcon: false,
        onSelectionChanged: (selection) => onChanged(selection.first),
      ),
    );
  }
}

/// タイトル + 現在値 + セグメント + 説明の評価行
/// （MentalPreSurveyView の ratingRow / 睡眠の質の行に相当）
class RatingRow extends StatelessWidget {
  final String title;
  final int value;
  final ValueChanged<int> onChanged;
  final String description;
  final String Function(int)? labelBuilder;

  const RatingRow({
    super.key,
    required this.title,
    required this.value,
    required this.onChanged,
    required this.description,
    this.labelBuilder,
  });

  @override
  Widget build(BuildContext context) {
    final secondary = Theme.of(context).colorScheme.onSurfaceVariant;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Text(title)),
            Text(
              '$value / 5',
              style: TextStyle(color: secondary, fontFeatures: const []),
            ),
          ],
        ),
        const SizedBox(height: 8),
        SegmentedRating(
          value: value,
          onChanged: onChanged,
          labelBuilder: labelBuilder,
        ),
        const SizedBox(height: 4),
        Text(
          description,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: secondary),
        ),
      ],
    );
  }
}

/// 背景グラデーション（HomeView などの LinearGradient 相当）
class GradientBackground extends StatelessWidget {
  final Widget child;
  const GradientBackground({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [scheme.surface, scheme.surfaceContainerHighest],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
      ),
      child: child,
    );
  }
}

/// 確認ダイアログ（SwiftUI の alert 2ボタン相当）。確定時 true を返す。
Future<bool> showConfirmDialog(
  BuildContext context, {
  required String title,
  String? message,
  String confirmLabel = 'OK',
  bool destructive = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: message != null ? Text(message) : null,
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('キャンセル'),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(
            confirmLabel,
            style: destructive ? const TextStyle(color: Colors.red) : null,
          ),
        ),
      ],
    ),
  );
  return result ?? false;
}

/// OKのみのアラート
Future<void> showOkDialog(
  BuildContext context, {
  required String title,
  String? message,
}) async {
  await showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: message != null ? Text(message) : null,
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('OK'),
        ),
      ],
    ),
  );
}
