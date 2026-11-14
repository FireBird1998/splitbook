import { mobileBuildSettings, widgetKey } from './config';
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
  Switch,
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
import { widgetSetupButtonLabel, widgetSetupChoices } from '@splitbook/shared/widget-setup';
import { counted, SEPARATOR } from '@splitbook/shared/separator';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { WidgetConfigurationScreenProps } from 'react-native-android-widget/src/api/register-widget-configuration-screen';
import { createWidgetsStore } from './widgets-native';
import { groupThemeIcons } from './ui/group-icon';
import { widgetLink } from './widget-links';
import { redrawBalances } from './widgets';

const pendingChoices = new Map<
  number,
  {
    accountId: string | null;
    groupId: string | null;
    hideAmounts: boolean;
    mode?: 'expense' | 'payment';
  }
>();
const store = createWidgetsStore(widgetKey(mobileBuildSettings, __DEV__));
/** Android configuration is deliberately independent of runtime.ts and its session/network reads. */
export function WidgetSetup({ widgetInfo, setResult }: WidgetConfigurationScreenProps) {
  const kind =
    widgetInfo.widgetName === 'Balances'
      ? 'balances'
      : widgetInfo.widgetName === 'Quick'
        ? 'quick'
        : 'group';
  const balances = kind === 'balances';
  const quick = kind === 'quick';
  const t = getSemanticTokens(useColorScheme() === 'dark' ? 'dark' : 'light');
  const [record, setRecord] = useState<{ copy: WidgetCopy | null; session: WidgetSession } | null>(
    null,
  );
  const [selected, setSelected] = useState<string | null>(null),
    [hideAmounts, setHideAmounts] = useState(false),
    [mode, setMode] = useState<'expense' | 'payment'>('expense'),
    [error, setError] = useState(''),
    [buttonLabel, setButtonLabel] = useState<'Save' | 'Add widget'>('Add widget');
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
          setButtonLabel(widgetSetupButtonLabel(setup));
          const accountId =
            value.session.status === 'authenticated' ? value.session.accountId : null;
          const choices = pendingChoices.get(widgetInfo.widgetId);
          const restored =
            choices?.accountId === accountId
              ? choices
              : widgetSetupChoices(
                  kind,
                  setup,
                  accountId,
                  value.copy?.accountId === accountId
                    ? (value.copy?.savedGroups?.rows.find((g) => !g.archived)?.id ?? null)
                    : null,
                );
          setSelected(quick ? (restored.groupId ?? 'ask') : restored.groupId);
          setHideAmounts(restored.hideAmounts);
          setMode(restored.mode ?? 'expense');
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
  }, [widgetInfo.widgetId, setResult, kind, quick]);
  const signedIn =
    record?.session.status === 'authenticated' &&
    record.copy?.accountId === record.session.accountId;
  const groups = signedIn ? (record.copy?.savedGroups?.rows.filter((g) => !g.archived) ?? []) : [];
  const blocked = !balances && (!signedIn || ((!quick || mode === 'payment') && !groups.length));
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
        !balances &&
        (latest.session.status !== 'authenticated' ||
          latest.copy?.accountId !== latest.session.accountId ||
          latest.session.accountId !== record?.copy?.accountId ||
          (!(quick && mode !== 'payment' && selected === 'ask') &&
            !latest.copy.savedGroups?.rows.some((g) => g.id === selected && !g.archived)))
      ) {
        setRecord(latest);
        setError('Choose a saved Group for this account.');
        return;
      }
      await store.saveSetup(
        balances
          ? { kind: 'balances', widgetId: widgetInfo.widgetId, hideAmounts }
          : quick
            ? {
                kind: 'quick',
                widgetId: widgetInfo.widgetId,
                accountId:
                  latest.session.status === 'authenticated' ? latest.session.accountId : '',
                groupId: selected === 'ask' ? null : selected!,
                ...(mode === 'payment' ? { mode } : {}),
              }
            : {
                kind: 'group',
                widgetId: widgetInfo.widgetId,
                accountId:
                  latest.session.status === 'authenticated' ? latest.session.accountId : '',
                groupId: selected!,
                hideAmounts,
              },
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
            accessibilityRole="button"
            onPress={cancel}
            style={{ padding: 8 }}
          >
            <Ionicons name="close" size={24} color={t.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            {copy(
              balances ? 'Balances widget' : quick ? 'Quick actions widget' : 'Group widget',
              true,
              22,
            )}
          </View>
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
              balances
                ? 'What you owe and are owed across your Groups.'
                : quick
                  ? 'Choose what this widget does, and where.'
                  : 'Choose the Group this widget shows.',
              false,
              16,
              t.textSecondary,
            )}
            {quick ? (
              <>
                {copy('WHAT IT DOES', true, 12, t.textSecondary)}
                <View
                  style={{
                    backgroundColor: t.surface,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: t.border,
                    overflow: 'hidden',
                  }}
                >
                  {(['expense', 'payment'] as const).map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="radio"
                      accessibilityLabel={value === 'expense' ? 'Add expense' : 'Record payment'}
                      accessibilityState={{ checked: mode === value }}
                      onPress={() => {
                        const groupId =
                          value === 'payment' && (!selected || selected === 'ask')
                            ? null
                            : selected;
                        setMode(value);
                        setSelected(value === 'expense' ? (groupId ?? 'ask') : groupId);
                        pendingChoices.set(widgetInfo.widgetId, {
                          accountId: record!.copy!.accountId,
                          groupId,
                          hideAmounts: false,
                          mode: value,
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
                      <Ionicons
                        name={value === 'expense' ? 'add-outline' : 'swap-horizontal-outline'}
                        size={24}
                        color={t.brand.main}
                      />
                      <View style={{ flex: 1, gap: 4 }}>
                        {copy(value === 'expense' ? 'Add expense' : 'Record payment', true, 16)}
                        {copy(
                          value === 'expense'
                            ? 'Opens the Expense form'
                            : 'Opens Settle up, on Record payment',
                          false,
                          12,
                          t.textSecondary,
                        )}
                      </View>
                      <Ionicons
                        name={mode === value ? 'radio-button-on' : 'radio-button-off'}
                        size={24}
                        color={t.brand.main}
                      />
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
            {!balances ? (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  {copy(quick ? 'WHERE' : 'YOUR GROUPS', true, 12, t.textSecondary)}
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
                  {quick && mode === 'expense' ? (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected === 'ask' }}
                      accessibilityLabel="Ask each time"
                      onPress={() => {
                        setSelected('ask');
                        pendingChoices.set(widgetInfo.widgetId, {
                          groupId: 'ask',
                          mode,
                          accountId: record!.copy!.accountId,
                          hideAmounts: false,
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
                      <View
                        style={{ padding: 12, backgroundColor: t.surfaceMuted, borderRadius: 12 }}
                      >
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
                          mode,
                          accountId: record!.copy!.accountId,
                          hideAmounts,
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
                        <Ionicons
                          name={groupThemeIcons[group.theme]}
                          size={22}
                          color={t.brand.main}
                        />
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
              </>
            ) : null}
            {!quick ? (
              <>
                {copy('ON THE WIDGET', true, 12, t.textSecondary)}
                <View
                  style={{
                    backgroundColor: t.surface,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: t.border,
                    padding: 16,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <View style={{ padding: 12, backgroundColor: t.brand.bg, borderRadius: 12 }}>
                    <Ionicons name="eye-off-outline" size={22} color={t.brand.main} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    {copy('Hide amounts', true, 16)}
                    {copy(
                      balances
                        ? 'Shows “You’re owed” without amounts'
                        : 'Shows “You owe” without names or amounts',
                      false,
                      12,
                      t.textSecondary,
                    )}
                  </View>
                  <Switch
                    accessibilityLabel="Hide amounts"
                    value={hideAmounts}
                    // The compact ListRow switch's colours (#976), as in Settings → Notifications.
                    thumbColor={
                      hideAmounts ? t.brand.main : t.mode === 'light' ? t.surface : t.textSecondary
                    }
                    trackColor={{ false: t.borderStrong, true: `${t.brand.main}80` }}
                    onValueChange={(value) => {
                      setHideAmounts(value);
                      pendingChoices.set(widgetInfo.widgetId, {
                        accountId:
                          record?.session.status === 'authenticated'
                            ? record.session.accountId
                            : null,
                        groupId: selected,
                        hideAmounts: value,
                      });
                    }}
                  />
                </View>
                {copy(
                  'Anyone who sees your unlocked phone can read this widget.',
                  false,
                  13,
                  t.textSecondary,
                )}
              </>
            ) : null}
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
            disabled={(!record && !error) || (!blocked && quick && mode === 'payment' && !selected)}
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
              blocked ? (!signedIn ? 'Open Splitbook' : 'Create a Group') : buttonLabel,
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
