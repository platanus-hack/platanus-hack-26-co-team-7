import { Platform, StatusBar, StyleSheet } from 'react-native';

export const SAFE_TOP = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0;

export const C = {
  bg: '#0d0d0d',
  card: '#1a1a1a',
  cardBorder: '#2a2a2a',
  elevated: '#222222',
  text: '#e8e0d4',
  textSecondary: '#8a8278',
  textMuted: '#5a5650',
  emergency: '#c9a86c',
  needHelp: '#a67c5b',
  safe: '#7a8c6a',
  active: '#5a9a4a',
  error: '#c44040',
  input: '#141414',
  inputBorder: '#333333',
  accent: '#c9a86c',
  avatarBg: '#2a2420',
  overlay: 'rgba(0, 0, 0, 0.7)',
} as const;

export const F = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  black: 'Inter_900Black',
} as const;

export function statusColor(status: string): string {
  switch (status) {
    case 'EMERGENCY': return C.emergency;
    case 'NEED_HELP': return C.needHelp;
    case 'SAFE': return C.safe;
    default: return C.textSecondary;
  }
}

export function initials(name: string): string {
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';
}

export const shared = StyleSheet.create({
  screenBg: { flex: 1, backgroundColor: C.bg },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 12, padding: 16, gap: 6 },
  label: { fontFamily: F.semibold, color: C.textMuted, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  heading: { fontFamily: F.extrabold, color: C.text, fontSize: 22, letterSpacing: -0.3 },
  text: { fontFamily: F.regular, color: C.text, fontSize: 14, lineHeight: 20 },
  textSecondary: { fontFamily: F.regular, color: C.textSecondary, fontSize: 13, lineHeight: 18 },
  input: { fontFamily: F.regular, backgroundColor: C.input, borderWidth: 1, borderColor: C.inputBorder, borderRadius: 10, padding: 14, color: C.text, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: C.inputBorder, borderRadius: 20, backgroundColor: C.input },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontFamily: F.medium, color: C.textSecondary, fontSize: 13 },
  chipTextActive: { fontFamily: F.bold, color: C.bg, fontSize: 13 },
  btnPrimary: { backgroundColor: C.accent, paddingVertical: 16, borderRadius: 10, alignItems: 'center' as const },
  btnPrimaryText: { fontFamily: F.extrabold, color: C.bg, fontSize: 15, letterSpacing: 0.3 },
  btnSecondary: { borderWidth: 1, borderColor: C.cardBorder, paddingVertical: 14, borderRadius: 10, alignItems: 'center' as const },
  btnSecondaryText: { fontFamily: F.semibold, color: C.textSecondary, fontSize: 14 },
  btnDisabled: { opacity: 0.4 },
  modalBackdrop: { flex: 1, backgroundColor: C.overlay, justifyContent: 'center' as const, padding: 20 },
  modalCard: { backgroundColor: C.card, borderRadius: 16, padding: 24, gap: 16, borderWidth: 1, borderColor: C.cardBorder },
  error: { fontFamily: F.medium, color: C.error, fontSize: 13 },
  switchRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingVertical: 6 },
  divider: { height: 1, backgroundColor: C.cardBorder },
  avatar: { width: 44, height: 44, borderRadius: 10, backgroundColor: C.avatarBg, alignItems: 'center' as const, justifyContent: 'center' as const },
  avatarText: { fontFamily: F.extrabold, color: C.textSecondary, fontSize: 14 },
});
