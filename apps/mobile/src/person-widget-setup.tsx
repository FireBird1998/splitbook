import { useEffect, useState } from 'react';
import {
  BackHandler,
  Image,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { Outfit_400Regular } from '@expo-google-fonts/outfit/400Regular';
import { Outfit_700Bold } from '@expo-google-fonts/outfit/700Bold';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { WidgetConfigurationScreenProps } from 'react-native-android-widget/src/api/register-widget-configuration-screen';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { widgetPeople } from '@splitbook/shared/widget-people';
import {
  widgetSavedTime,
  type WidgetCopy,
  type WidgetSession,
} from '@splitbook/shared/balances-widget';
import { widgetSetupButtonLabel } from '@splitbook/shared/widget-setup';
import { mobileBuildSettings, widgetKey } from './config';
import { createWidgetsStore } from './widgets-native';
import { redrawBalances } from './widgets';
import { widgetLink } from './widget-links';
import lightMark from '../assets/widgets/setup-mark-light.png';
import darkMark from '../assets/widgets/setup-mark-dark.png';

const store = createWidgetsStore(widgetKey(mobileBuildSettings, __DEV__));
const pending = new Map<
  number,
  { accountId: string; personId: string | null; hideAmounts: boolean }
>();
const sharedNames = (names: string[]) =>
  names.length > 2
    ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
    : names.join(' and ');
/** Configuration reads only the Widget copy and device setup. It never boots the controller. */
export function PersonWidgetSetupScreen({ widgetInfo, setResult }: WidgetConfigurationScreenProps) {
  const t = getSemanticTokens(useColorScheme() === 'dark' ? 'dark' : 'light');
  const [fontsReady] = useFonts({ Outfit_400Regular, Outfit_700Bold });
  const [record, setRecord] = useState<{ copy: WidgetCopy | null; session: WidgetSession } | null>(
    null,
  );
  const [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [buttonLabel, setButtonLabel] = useState<'Save' | 'Add widget'>('Add widget'),
    [anotherAccount, setAnotherAccount] = useState(false),
    [hideAmounts, setHideAmounts] = useState(false);
  const cancel = () => {
    pending.delete(widgetInfo.widgetId);
    setResult('cancel');
  };
  useEffect(() => {
    let alive = true;
    void Promise.all([store.read(), store.setup(widgetInfo.widgetId)])
      .then(([value, saved]) => {
        if (!alive) return;
        setRecord(value);
        setButtonLabel(widgetSetupButtonLabel(saved));
        const accountId = value.session.status === 'authenticated' ? value.session.accountId : null;
        const choices = accountId ? widgetPeople(value.copy, accountId) : [];
        const other = saved?.kind === 'person' && saved.accountId !== accountId;
        setAnotherAccount(other);
        const held = pending.get(widgetInfo.widgetId);
        setHideAmounts(
          held?.accountId === accountId
            ? held.hideAmounts
            : saved?.kind === 'person' && saved.accountId === accountId
              ? saved.hideAmounts === true
              : false,
        );
        const preferred =
          held?.accountId === accountId
            ? held.personId
            : saved?.kind === 'person' && saved.accountId === accountId
              ? saved.person.id
              : other
                ? null
                : (choices[0]?.id ?? null);
        setSelected(choices.some((person) => person.id === preferred) ? preferred : null);
      })
      .catch(() => {
        if (alive) setError('Could not read saved people. Open Splitbook and try again.');
      });
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      cancel();
      return true;
    });
    return () => {
      alive = false;
      back.remove();
    };
  }, [widgetInfo.widgetId, setResult]);
  const accountId = record?.session.status === 'authenticated' ? record.session.accountId : null;
  const signedIn = !!accountId && record?.copy?.accountId === accountId;
  const choices = signedIn ? widgetPeople(record!.copy, accountId!) : [];
  const blocked = !!record && (!signedIn || !choices.length);
  const stamp = choices.length
    ? Math.min(...choices.flatMap((person) => person.groups.map((group) => group.verifiedAt)))
    : null;
  const copy = (value: string, bold = false, size = 14, ink = t.text) => (
    <Text
      style={{
        fontFamily: fontsReady ? (bold ? 'Outfit_700Bold' : 'Outfit_400Regular') : undefined,
        fontSize: size,
        color: ink,
      }}
    >
      {value}
    </Text>
  );
  const confirm = async () => {
    try {
      const latest = await store.read();
      const owner = latest.session.status === 'authenticated' ? latest.session.accountId : null;
      const person =
        owner && owner === accountId
          ? widgetPeople(latest.copy, owner).find((person) => person.id === selected)
          : null;
      if (!person) {
        setRecord(latest);
        setSelected(null);
        setError('Choose a saved person for this account.');
        return;
      }
      await store.saveSetup({
        kind: 'person',
        widgetId: widgetInfo.widgetId,
        accountId: owner!,
        person: { id: person.id, firstName: person.firstName, initials: person.initials },
        hideAmounts,
      });
      await redrawBalances();
      pending.delete(widgetInfo.widgetId);
      setResult('ok');
    } catch {
      setError('Could not save this widget. Try again.');
    }
  };
  return (
    <SafeAreaProvider>
      <StatusBar style={t.mode === 'dark' ? 'light' : 'dark'} />
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
          <View style={{ flex: 1 }}>{copy('Person widget', true, 22)}</View>
        </View>
        {!record && !error ? (
          <View style={{ padding: 24 }}>{copy('Loading saved people…')}</View>
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
            {!signedIn ? (
              <Image
                source={t.mode === 'dark' ? darkMark : lightMark}
                style={{ width: 48, height: 48 }}
              />
            ) : (
              <Ionicons name="people-outline" size={40} color={t.brand.main} />
            )}
            {copy(!signedIn ? 'Sign in to Splitbook first' : 'No people saved yet', true, 20)}
            {copy(
              !signedIn
                ? 'Widgets show people once you’re signed in on this phone.'
                : 'Open Splitbook to load the people in your Groups.',
              false,
              15,
              t.textSecondary,
            )}
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 22, flexGrow: 1 }}>
            {copy('Choose the person this widget is about.', false, 16, t.textSecondary)}
            {anotherAccount
              ? copy(
                  'This widget was set up by another account. Choose a person for this account.',
                  false,
                  14,
                  t.textSecondary,
                )
              : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              {copy('People in your Groups', true, 12, t.textSecondary)}
              {copy(
                stamp !== null ? widgetSavedTime(stamp, Date.now()) : 'Nothing saved yet',
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
              {choices.map((person) => (
                <Pressable
                  key={person.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected === person.id }}
                  accessibilityLabel={`${person.name}, ${person.groups.map((group) => group.name).join(', ')}`}
                  onPress={() => {
                    setSelected(person.id);
                    setError('');
                    pending.set(widgetInfo.widgetId, {
                      accountId: accountId!,
                      personId: person.id,
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
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      backgroundColor: t.brand.bg,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {copy(person.initials, true, 16, t.brand.main)}
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    {copy(person.name, true, 16)}
                    {copy(
                      sharedNames(person.groups.map((group) => group.name)),
                      false,
                      12,
                      t.textSecondary,
                    )}
                  </View>
                  <Ionicons
                    name={selected === person.id ? 'radio-button-on' : 'radio-button-off'}
                    size={24}
                    color={selected === person.id ? t.brand.main : t.textSecondary}
                  />
                </Pressable>
              ))}
            </View>
            {copy('On the widget', true, 12, t.textSecondary)}
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
                {copy('Counts only: no name or amounts', false, 12, t.textSecondary)}
              </View>
              <Switch
                accessibilityLabel="Hide amounts"
                value={hideAmounts}
                thumbColor={
                  hideAmounts ? t.brand.main : t.mode === 'light' ? t.surface : t.textSecondary
                }
                trackColor={{ false: t.borderStrong, true: `${t.brand.main}80` }}
                onValueChange={(value) => {
                  setHideAmounts(value);
                  pending.set(widgetInfo.widgetId, {
                    accountId: accountId!,
                    personId: selected,
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
            disabled={!record || (!blocked && !selected)}
            onPress={() => {
              if (blocked) {
                cancel();
                void Linking.openURL(widgetLink(!signedIn ? 'sign-in' : 'home'));
              } else void confirm();
            }}
            style={{
              backgroundColor: t.brand.main,
              padding: 18,
              borderRadius: 14,
              alignItems: 'center',
              opacity: !record || (!blocked && !selected) ? 0.5 : 1,
            }}
          >
            {copy(blocked ? 'Open Splitbook' : buttonLabel, true, 16, t.brand.contrastText)}
          </Pressable>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
