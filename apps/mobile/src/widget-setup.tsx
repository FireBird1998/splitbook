import { useEffect, useState } from 'react';
import {
  View,
  Image,
  Text,
  Pressable,
  ScrollView,
  useColorScheme,
  Linking,
  BackHandler,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Outfit_400Regular } from '@expo-google-fonts/outfit/400Regular';
import { Outfit_700Bold } from '@expo-google-fonts/outfit/700Bold';
import Ionicons from '@expo/vector-icons/Ionicons';
import lightMark from '../assets/widgets/setup-mark-light.png';
import darkMark from '../assets/widgets/setup-mark-dark.png';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import {
  widgetSavedTime,
  type WidgetCopy,
  type WidgetSession,
} from '@splitbook/shared/balances-widget';
import { counted, SEPARATOR } from '@splitbook/shared/separator';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { WidgetConfigurationScreenProps } from 'react-native-android-widget/src/api/register-widget-configuration-screen';
import { createWidgetsStore } from './widgets-native';
import { groupThemeIcons } from './ui/group-icon';
import { widgetLink } from './widget-links';
import { redrawBalances } from './widgets';

const pendingChoices = new Map<number, { accountId: string; groupId: string }>();
const store = createWidgetsStore(process.env.EXPO_PUBLIC_API_URL ?? '');
/** Android configuration is deliberately independent of runtime.ts and its session/network reads. */
export function WidgetSetup({ widgetInfo, setResult }: WidgetConfigurationScreenProps) {
  const quick = widgetInfo.widgetName === 'Quick';
  const t = getSemanticTokens(useColorScheme() === 'dark' ? 'dark' : 'light');
  const [record, setRecord] = useState<{ copy: WidgetCopy | null; session: WidgetSession } | null>(
    null,
  );
  const [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState('');
  const cancel = () => {
    pendingChoices.delete(widgetInfo.widgetId);
    setResult('cancel');
  };
  const [fontsReady] = useFonts({ Outfit_400Regular, Outfit_700Bold });
  useEffect(() => {
    let alive = true;
    void Promise.all([store.read(), store.setup(widgetInfo.widgetId)])
      .then(([value, setup]) => {
        if (alive) {
          setRecord(value);
          setSelected(
            (pendingChoices.get(widgetInfo.widgetId)?.accountId === value.copy?.accountId
              ? pendingChoices.get(widgetInfo.widgetId)?.groupId
              : undefined) ??
              (setup?.kind === 'quick' ? (setup.groupId ?? 'ask') : setup?.groupId) ??
              (quick ? 'ask' : undefined) ??
              value.copy?.savedGroups?.rows.find((g) => !g.archived)?.id ??
              null,
          );
        }
      })
      .catch(() => setError('Could not read saved Groups. Open Splitbook and try again.'));
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      pendingChoices.delete(widgetInfo.widgetId);
      setResult('cancel');
      return true;
    });
    return () => {
      alive = false;
      back.remove();
    };
  }, [widgetInfo.widgetId, setResult]);
  const signedIn =
    record?.session.status === 'authenticated' &&
    record.copy?.accountId === record.session.accountId;
  const groups = signedIn ? (record.copy?.savedGroups?.rows.filter((g) => !g.archived) ?? []) : [];
  const blocked = !signedIn || (!quick && !groups.length);
  const copy = (value: string, bold = false, size = 14, color = t.text) => (
    <Text
      style={{
        fontFamily: fontsReady ? (bold ? 'Outfit_700Bold' : 'Outfit_400Regular') : undefined,
        fontSize: size,
        color,
      }}
    >
      {value}
    </Text>
  );
  const confirm = async () => {
    try {
      const latest = await store.read();
      if (
        latest.session.status !== 'authenticated' ||
        latest.copy?.accountId !== latest.session.accountId ||
        latest.session.accountId !== record?.copy?.accountId ||
        (!(quick && selected === 'ask') &&
          !latest.copy.savedGroups?.rows.some((g) => g.id === selected && !g.archived))
      ) {
        setRecord(latest);
        setError('Choose a saved Group for this account.');
        return;
      }
      const identity = { widgetId: widgetInfo.widgetId, accountId: latest.session.accountId };
      await store.saveSetup(
        quick
          ? { ...identity, kind: 'quick', groupId: selected === 'ask' ? null : selected! }
          : { ...identity, kind: 'group', groupId: selected! },
      );
      await redrawBalances();
      pendingChoices.delete(widgetInfo.widgetId);
      setResult('ok');
    } catch {
      setError('Could not save this widget. Try again.');
    }
  };
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, gap: 20 }}>
          <Pressable
            accessibilityLabel="Cancel widget setup"
            onPress={cancel}
            style={{ padding: 8 }}
          >
            <Ionicons name="close" size={24} color={t.text} />
          </Pressable>
          {copy(quick ? 'Add expense widget' : 'Group widget', true, 22)}
        </View>
        {record === null && !error ? (
          <View style={{ padding: 24 }}>{copy('Loading saved Groups…')}</View>
        ) : blocked ? (
          <View
            style={{
              flex: 1,
              padding: 28,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 18,
            }}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                backgroundColor: t.brand.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {!signedIn ? (
                <Image
                  source={t.mode === 'dark' ? darkMark : lightMark}
                  style={{ width: 32, height: 32 }}
                />
              ) : (
                <Ionicons name="people-outline" size={32} color={t.brand.main} />
              )}
            </View>
            {copy(!signedIn ? 'Sign in to Splitbook first' : 'No Groups yet', true, 20)}
            {copy(
              !signedIn
                ? 'Widgets show your Groups once you’re signed in on this phone.'
                : 'Create or join a Group, then add this widget again.',
              false,
              15,
              t.textSecondary,
            )}
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 22, flexGrow: 1 }}>
            {copy(
              quick
                ? 'Choose where this widget starts an Expense.'
                : 'Choose the Group this widget shows.',
              false,
              16,
              t.textSecondary,
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {copy('YOUR GROUPS', true, 12, t.textSecondary)}
              {copy(
                record!.copy!.savedGroups
                  ? widgetSavedTime(record!.copy!.savedGroups.verifiedAt, Date.now())
                  : 'Nothing saved yet',
                false,
                12,
                t.textMuted,
              )}
            </View>
            <View
              style={{
                backgroundColor: t.surface,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: t.border,
                overflow: 'hidden',
              }}
            >
              {quick ? (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected === 'ask' }}
                  accessibilityLabel="Ask each time"
                  onPress={() => {
                    setSelected('ask');
                    pendingChoices.set(widgetInfo.widgetId, {
                      groupId: 'ask',
                      accountId: record!.copy!.accountId,
                    });
                  }}
                  style={{
                    padding: 16,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: t.border,
                  }}
                >
                  <View style={{ padding: 12, backgroundColor: t.surfaceMuted, borderRadius: 12 }}>
                    <Ionicons name="list-outline" size={22} color={t.textSecondary} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    {copy('Ask each time', true, 16)}
                    {copy('Pick the Group when you tap', false, 12, t.textSecondary)}
                  </View>
                  <Ionicons
                    name={selected === 'ask' ? 'radio-button-on' : 'radio-button-off'}
                    size={24}
                    color={t.brand.main}
                  />
                </Pressable>
              ) : null}
              {groups.map((group) => (
                <Pressable
                  key={group.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected === group.id }}
                  accessibilityLabel={group.name}
                  onPress={() => {
                    setSelected(group.id);
                    pendingChoices.set(widgetInfo.widgetId, {
                      groupId: group.id,
                      accountId: record!.copy!.accountId,
                    });
                  }}
                  style={{
                    padding: 16,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: t.border,
                  }}
                >
                  <View style={{ padding: 12, backgroundColor: t.brand.bg, borderRadius: 12 }}>
                    <Ionicons name={groupThemeIcons[group.theme]} size={22} color={t.brand.main} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    {copy(group.name, true, 16)}
                    {copy(
                      `${getGroupTheme(group.theme).label}${SEPARATOR}${counted(group.members, 'member')}${group.currencies > 1 ? SEPARATOR + counted(group.currencies, 'currency', 'currencies') : ''}`,
                      false,
                      12,
                      t.textSecondary,
                    )}
                  </View>
                  <Ionicons
                    name={selected === group.id ? 'radio-button-on' : 'radio-button-off'}
                    size={24}
                    color={selected === group.id ? t.brand.main : t.textSecondary}
                  />
                </Pressable>
              ))}
            </View>
            {!quick &&
              copy(
                'Anyone who sees your unlocked phone can read this widget.',
                false,
                13,
                t.textSecondary,
              )}
          </ScrollView>
        )}
        {error ? (
          <View style={{ padding: 20 }}>{copy(error, false, 14, t.status.negative)}</View>
        ) : null}
        <View
          style={{
            padding: 20,
            borderTopWidth: 1,
            borderTopColor: t.border,
            backgroundColor: t.surface,
          }}
        >
          <Pressable
            accessibilityRole="button"
            disabled={!record && !error}
            onPress={() => {
              if (blocked) {
                setResult('cancel');
                void Linking.openURL(widgetLink(!signedIn ? 'sign-in' : 'create-group'));
              } else void confirm();
            }}
            style={{
              backgroundColor: t.brand.main,
              padding: 18,
              borderRadius: 14,
              alignItems: 'center',
            }}
          >
            {copy(
              blocked ? (!signedIn ? 'Open Splitbook' : 'Create a Group') : 'Add widget',
              true,
              16,
              t.brand.contrastText,
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
