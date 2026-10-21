import { memo, useEffect, useRef, useState, type Ref } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CURRENCIES, getCurrency } from '@splitbook/shared/currency';
import { GROUP_THEME_LIST, getGroupTheme } from '@splitbook/shared/group-themes';
import { MAX_EXTRA_CURRENCIES } from '@splitbook/shared/group-currencies';
import type { GroupField, GroupFieldErrors } from '../data/group-draft';
import type { GroupDraft, InvitationPreview as InvitationPreviewModel } from '../data/types';
import {
  Banner,
  Card,
  CompactButton,
  CompactText,
  Divider,
  LinearProgress,
  SectionHeader,
  TileGrid,
  TopBar,
  radius,
  useTap,
} from './compact';
import { savingNeedsConnection } from './offline-notice';
import { useStartWhileUnfocused } from './start-while-unfocused';
import { Copy, Icon } from './primitives';
import { fonts, useTheme } from './theme';
import { PRODUCT_NAME } from '../product';

export type GroupCreateDraft = GroupDraft;

export interface GroupCreateFormProps {
  draft: GroupCreateDraft;
  onChange: (patch: Partial<GroupCreateDraft>) => void;
  onSubmit: () => void;
  busy: boolean;
  message: string | null;
  uncertain: boolean;
  /** Creating needs a connection: Create is unavailable, and the entries stay. */
  offline?: boolean;
  onCheckGroups: () => void;
  onDiscard: () => void;
  /** Corrections to show now: after a field was left or a create was attempted. */
  errors?: GroupFieldErrors;
  /** Changes once per rejected create, naming the first field to correct. */
  focus?: { field: GroupField; request: number } | null;
  onLeaveField?: (field: GroupField) => void;
  /** Scrolls a field into view within the screen's ScrollView. */
  onReveal?: (section: View) => void;
  /**
   * Scrolls a note that appears under the actions, such as "Sending this Group…", just far
   * enough to show it whole within the screen's ScrollView.
   */
  onShowStatus?: (note: View) => void;
}

/** A correction shown directly below the control it belongs to. */
export const FieldError = memo(function FieldError({
  message,
  ref,
}: {
  message?: string | null;
  ref?: Ref<View>;
}) {
  const theme = useTheme();
  if (!message) return null;
  return (
    <View
      ref={ref}
      accessible
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', gap: 6 }}
    >
      <Icon name="alert-circle-outline" size={18} color={theme.status.negative} />
      <Copy style={{ flex: 1, fontSize: 14, lineHeight: 20, color: theme.status.negative }}>
        {message}
      </Copy>
    </View>
  );
});

export function Field({
  label,
  hint,
  required = false,
  error,
  inputRef,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string | null;
  inputRef?: Ref<TextInput>;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 7 }}>
      <Copy style={{ fontFamily: fonts.medium, fontSize: 14 }}>
        {label}
        {required && <Copy style={{ fontSize: 14, color: theme.textSecondary }}> · Required</Copy>}
      </Copy>
      <TextInput
        {...props}
        ref={inputRef}
        accessibilityLabel={required ? `${label}, required` : label}
        accessibilityHint={error ? `${error}${hint ? ` ${hint}` : ''}` : hint}
        placeholderTextColor={theme.textSecondary}
        selectionColor={theme.brand.main}
        style={[
          {
            minHeight: 52,
            paddingHorizontal: 15,
            paddingVertical: 13,
            borderRadius: 12,
            borderWidth: error ? 2 : 1,
            borderColor: error ? theme.status.negative : theme.border,
            backgroundColor: theme.surface,
            color: theme.text,
            fontFamily: fonts.regular,
            fontSize: 16,
            lineHeight: 24,
            opacity: props.editable === false ? 0.65 : 1,
          },
          props.multiline && { minHeight: 100, textAlignVertical: 'top' },
          props.style,
        ]}
      />
      {hint && (
        <Copy style={{ fontSize: 13, lineHeight: 19, color: theme.textSecondary }}>{hint}</Copy>
      )}
      <FieldError message={error} />
    </View>
  );
}

/** Content only: the screen supplies a keyboard-aware ScrollView. */
export function GroupCreateForm({
  draft,
  onChange,
  onSubmit,
  busy,
  message,
  uncertain,
  offline = false,
  onCheckGroups,
  onDiscard,
  errors = {},
  focus = null,
  onLeaveField = () => undefined,
  onReveal = () => undefined,
  onShowStatus = () => undefined,
}: GroupCreateFormProps) {
  const theme = useTheme();
  const status = useRef<View>(null);
  useEffect(() => {
    // Create sits at the end of a long form: its note appears below it, maybe off screen.
    if (busy && status.current) onShowStatus(status.current);
  }, [busy]);
  const sections = useRef<Partial<Record<GroupField, View | null>>>({});
  const inputs = useRef<Partial<Record<GroupField, TextInput | null>>>({});
  useEffect(() => {
    // Each rejected create asks once for the first invalid field; later edits never move focus.
    if (!focus) return;
    const section = sections.current[focus.field];
    if (section) onReveal(section);
    inputs.current[focus.field]?.focus();
  }, [focus?.request]);
  const section = (field: GroupField) => (node: View | null) => {
    sections.current[field] = node;
  };
  const input = (field: GroupField) => (node: TextInput | null) => {
    inputs.current[field] = node;
  };
  const descriptor = getGroupTheme(draft.category);
  const currency = getCurrency(draft.defaultCurrency);
  const nameStart = useStartWhileUnfocused(() => onLeaveField('name'));
  // The main currency, or a new Trip's extra currency (#723), chosen from the same list.
  const [choosing, setChoosing] = useState<'main' | 'extra' | null>(null);
  // A drag that starts on the field or on a currency never presses it (#684): one for the form,
  // one for the list over it.
  const fieldTap = useTap();
  const currencyTap = useTap();
  const [currencySearch, setCurrencySearch] = useState('');
  const locked = busy || uncertain;
  const creating = `Sending this Group. Keep this screen open until ${PRODUCT_NAME} confirms it.`;
  const noun = descriptor.nouns.singular;
  const capitalizedNoun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const extras = draft.extraCurrencies;
  const listed =
    choosing === 'extra'
      ? CURRENCIES.filter(
          (item) => item.code !== draft.defaultCurrency && !extras.includes(item.code),
        )
      : CURRENCIES;
  const matchingCurrencies = listed.filter((item) =>
    `${item.code} ${item.name}`.toLowerCase().includes(currencySearch.trim().toLowerCase()),
  );
  const chip = (pressed: boolean, added: boolean) => ({
    minHeight: 40,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingLeft: added ? 14 : 12,
    paddingRight: added ? 10 : 14,
    borderRadius: radius.tile,
    borderWidth: 1,
    borderColor: added ? theme.brand.main : theme.borderStrong,
    backgroundColor: added ? theme.brand.bg : pressed ? theme.surfaceMuted : theme.surface,
  });

  return (
    <View style={{ gap: 12 }}>
      <CompactText tone="secondary">
        Choose a Theme, name it, then invite the people you share with.
      </CompactText>

      {uncertain && (
        <View style={{ gap: 8 }}>
          <Banner
            tone="warning"
            standing
            title="Your Group may already exist"
            message="We couldn’t confirm whether it was created. Your entries are kept here. Check your Groups before creating another one."
          />
          <CompactButton label="Check my Groups" block onPress={onCheckGroups} disabled={busy} />
        </View>
      )}

      <View style={{ gap: 6 }}>
        <SectionHeader title="Theme" />
        <View accessibilityRole="radiogroup">
          <TileGrid>
            {GROUP_THEME_LIST.map((option) => {
              const selected = option.id === draft.category;
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked: selected, disabled: locked }}
                  disabled={locked}
                  onPress={() => onChange({ category: option.id })}
                  style={({ pressed }) => ({
                    minHeight: 56,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor: selected ? theme.brand.main : theme.border,
                    borderRadius: radius.tile,
                    backgroundColor: selected
                      ? theme.brand.bg
                      : pressed
                        ? theme.surfaceMuted
                        : theme.surface,
                    opacity: locked ? 0.6 : 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  })}
                >
                  <CompactText accessible={false}>{option.icon}</CompactText>
                  <CompactText
                    weight={selected ? 'semibold' : 'medium'}
                    tone={selected ? 'brand' : 'primary'}
                    style={{ flex: 1 }}
                  >
                    {option.label}
                  </CompactText>
                  {selected && <Icon name="checkmark" size={18} color={theme.brand.main} />}
                </Pressable>
              );
            })}
          </TileGrid>
        </View>
        <CompactText variant="small" tone="secondary" style={{ paddingHorizontal: 2 }}>
          {descriptor.tagline}
        </CompactText>
      </View>

      <View ref={section('name')}>
        <Field
          label={`${capitalizedNoun} name`}
          required
          hint="Everyone you invite sees this name."
          inputRef={input('name')}
          error={errors.name}
          value={draft.name}
          onChangeText={(name) => onChange({ name })}
          selection={nameStart.selection}
          onFocus={nameStart.onFocus}
          onBlur={nameStart.onBlur}
          maxLength={100}
          placeholder={descriptor.namePlaceholder}
          autoCapitalize="sentences"
          returnKeyType="done"
          editable={!locked}
        />
      </View>

      <View style={{ gap: 7 }}>
        <Copy style={{ fontFamily: fonts.medium, fontSize: 14 }}>Main currency</Copy>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Main currency, ${draft.defaultCurrency}${currency ? `, ${currency.name}` : ''}`}
          accessibilityHint="Choose the main currency for this Group"
          accessibilityState={{ disabled: locked }}
          disabled={locked}
          {...fieldTap.on(() => {
            setCurrencySearch('');
            setChoosing('main');
          })}
          style={({ pressed }) => ({
            minHeight: 52,
            paddingHorizontal: 14,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: radius.tile,
            backgroundColor:
              locked || (pressed && !fieldTap.dragged) ? theme.surfaceMuted : theme.surface,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          })}
        >
          <CompactText style={{ fontFamily: fonts.mono }}>{draft.defaultCurrency}</CompactText>
          <CompactText tone="secondary" style={{ flex: 1 }}>
            {currency?.name}
          </CompactText>
          <Icon name="chevron-down-outline" size={18} />
        </Pressable>
        <CompactText variant="small" tone="secondary">
          Locked once money is recorded. Pick the one most of you settle in.
        </CompactText>
      </View>

      {descriptor.extraCurrenciesAtSetup && (
        // A new Trip's extra currencies (#723), as the board "Android · New Trip offers extra
        // currencies" shows them; a Household adds them later in settings.
        <Card padded>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <CompactText variant="heading" accessibilityRole="header">
                Spending abroad?
              </CompactText>
              <View
                style={{
                  paddingHorizontal: 8,
                  borderRadius: 6,
                  backgroundColor: theme.surfaceMuted,
                }}
              >
                <CompactText variant="caption" tone="secondary">
                  Optional
                </CompactText>
              </View>
              <CompactText variant="caption" tone="secondary" style={{ marginLeft: 'auto' }}>
                {`${extras.length} of ${MAX_EXTRA_CURRENCIES}`}
              </CompactText>
            </View>
            <CompactText variant="small" tone="secondary">
              Add each currency you’ll pay in. Expenses keep the amount on the receipt; nothing is
              converted.
            </CompactText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {extras.map((code) => (
                <Pressable
                  key={code}
                  accessibilityRole="button"
                  accessibilityLabel={`${code}, ${getCurrency(code)?.name ?? code}, added. Remove`}
                  accessibilityState={{ disabled: locked }}
                  disabled={locked}
                  {...fieldTap.on(() =>
                    onChange({ extraCurrencies: extras.filter((item) => item !== code) }),
                  )}
                  style={({ pressed }) => chip(pressed && !fieldTap.dragged, true)}
                >
                  <CompactText weight="semibold" tone="brand" style={{ fontFamily: fonts.mono }}>
                    {code}
                  </CompactText>
                  <Icon name="close" size={16} color={theme.brand.main} />
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add a currency"
                accessibilityState={{ disabled: locked || extras.length >= MAX_EXTRA_CURRENCIES }}
                disabled={locked || extras.length >= MAX_EXTRA_CURRENCIES}
                {...fieldTap.on(() => {
                  setCurrencySearch('');
                  setChoosing('extra');
                })}
                style={({ pressed }) => ({
                  ...chip(pressed && !fieldTap.dragged, false),
                  opacity: extras.length >= MAX_EXTRA_CURRENCIES ? 0.5 : 1,
                })}
              >
                <Icon name="add-outline" size={18} />
                <CompactText weight="medium">Add a currency</CompactText>
              </Pressable>
            </View>
            <CompactText variant="caption" tone="secondary">
              Anyone in the Group can add more later.
            </CompactText>
          </View>
        </Card>
      )}

      {descriptor.dates === 'bounded' && (
        <Card padded>
          <View style={{ gap: 12 }}>
            <View style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="calendar-outline" color={theme.brand.main} size={20} />
                <CompactText variant="heading">Trip dates</CompactText>
              </View>
              <CompactText variant="small" tone="secondary">
                Optional. Leave these blank if your plans are still taking shape.
              </CompactText>
            </View>
            <View ref={section('startDate')}>
              <Field
                label="Start date"
                inputRef={input('startDate')}
                error={errors.startDate}
                value={draft.startDate}
                onChangeText={(startDate) => onChange({ startDate })}
                onBlur={() => onLeaveField('startDate')}
                placeholder="YYYY-MM-DD"
                hint="Year-month-day, for example 2026-10-15."
                autoCorrect={false}
                autoCapitalize="none"
                maxLength={10}
                returnKeyType="done"
                editable={!locked}
              />
            </View>
            <View ref={section('endDate')}>
              <Field
                label="End date"
                inputRef={input('endDate')}
                error={errors.endDate}
                value={draft.endDate}
                onChangeText={(endDate) => onChange({ endDate })}
                onBlur={() => onLeaveField('endDate')}
                placeholder="YYYY-MM-DD"
                hint="On or after the start date."
                autoCorrect={false}
                autoCapitalize="none"
                maxLength={10}
                returnKeyType="done"
                editable={!locked}
              />
            </View>
          </View>
        </Card>
      )}

      <Field
        label="Description (optional)"
        value={draft.description}
        onChangeText={(description) => onChange({ description })}
        placeholder={`What’s this ${noun} for?`}
        maxLength={500}
        multiline
        autoCapitalize="sentences"
        editable={!locked}
      />

      {message && <Banner tone={uncertain ? 'warning' : 'error'} message={message} />}
      <View style={{ gap: 8 }}>
        {!uncertain && (
          // Create stays available for incomplete input so it can explain what is missing.
          <CompactButton
            label={`Create ${capitalizedNoun}`}
            busy={busy ? 'Creating your Group…' : undefined}
            block
            icon="add-outline"
            hint={busy ? creating : offline ? savingNeedsConnection : undefined}
            disabled={busy || offline}
            onPress={onSubmit}
          />
        )}
        {busy && (
          <View ref={status}>
            <CompactText variant="small" tone="secondary" style={{ textAlign: 'center' }}>
              {creating}
            </CompactText>
          </View>
        )}
        {offline && !busy && !uncertain && (
          <CompactText variant="small" tone="secondary" style={{ textAlign: 'center' }}>
            {savingNeedsConnection}
          </CompactText>
        )}
        <CompactButton
          label={uncertain ? 'Leave this form' : 'Cancel'}
          variant="tonal"
          block
          disabled={busy}
          onPress={onDiscard}
        />
        <CompactText variant="small" tone="secondary" style={{ textAlign: 'center' }}>
          You’ll be the first member and Group admin. Invite others after creation.
        </CompactText>
      </View>

      <Modal
        visible={choosing !== null}
        animationType="slide"
        onRequestClose={() => setChoosing(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
          <TopBar
            title={choosing === 'extra' ? 'Add a currency' : 'Choose currency'}
            actions={
              <CompactButton label="Done" variant="text" dense onPress={() => setChoosing(null)} />
            }
          />
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <Field
              label="Search currencies"
              value={currencySearch}
              onChangeText={setCurrencySearch}
              placeholder="Currency name or code"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="done"
            />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          >
            {matchingCurrencies.length ? (
              <Card>
                {matchingCurrencies.map((item, index) => (
                  <View key={item.code}>
                    {index > 0 ? <Divider /> : null}
                    <Pressable
                      accessibilityRole={choosing === 'extra' ? 'button' : 'radio'}
                      accessibilityLabel={`${item.code}, ${item.name}`}
                      accessibilityState={
                        choosing === 'extra'
                          ? undefined
                          : { checked: item.code === draft.defaultCurrency }
                      }
                      {...currencyTap.on(() => {
                        onChange(
                          choosing === 'extra'
                            ? { extraCurrencies: [...extras, item.code] }
                            : { defaultCurrency: item.code },
                        );
                        setChoosing(null);
                      })}
                      style={({ pressed }) => ({
                        minHeight: 56,
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        backgroundColor:
                          pressed && !currencyTap.dragged ? theme.surfaceMuted : undefined,
                      })}
                    >
                      <CompactText style={{ fontFamily: fonts.mono }}>{item.code}</CompactText>
                      <CompactText style={{ flex: 1 }}>{item.name}</CompactText>
                      {choosing === 'main' && item.code === draft.defaultCurrency && (
                        <Icon name="checkmark" color={theme.brand.main} />
                      )}
                    </Pressable>
                  </View>
                ))}
              </Card>
            ) : (
              <CompactText tone="secondary">No currencies match your search.</CompactText>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

export type InvitationPreviewData = InvitationPreviewModel;

/** Why Join waits while the app counts itself offline. */
export const joinNeedsConnection = 'Joining needs a connection.';

export interface InvitationPreviewProps {
  preview: InvitationPreviewData | null;
  status: 'loading' | 'ready' | 'joining' | 'error' | 'invalid' | 'denied';
  message: string | null;
  alreadyMember: boolean;
  signedIn?: boolean;
  /** Joining needs a connection: Join is unavailable, and says why. */
  offline?: boolean;
  onJoin: () => void;
  onOpenGroup: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

export function InvitationPreview({
  preview,
  status,
  message,
  alreadyMember,
  signedIn = true,
  offline = false,
  onJoin,
  onOpenGroup,
  onRetry,
  onCancel,
}: InvitationPreviewProps) {
  const descriptor = preview ? getGroupTheme(preview.category) : null;
  const joining = status === 'joining';
  // Opening a Group the member is already in, or signing in, isn't a write.
  const waiting = offline && signedIn && !alreadyMember && !joining;
  if (status === 'loading') {
    return (
      <View style={{ gap: 12 }}>
        <LinearProgress label="Opening your invitation…" />
        <CompactText tone="secondary">Opening your invitation…</CompactText>
        <CompactButton label="Cancel" variant="tonal" block onPress={onCancel} />
      </View>
    );
  }
  if (!preview || !descriptor || ['invalid', 'denied', 'error'].includes(status)) {
    return (
      <View style={{ gap: 12 }}>
        <Banner
          tone="error"
          title={
            status === 'invalid'
              ? 'This invitation isn’t available'
              : status === 'denied'
                ? 'Access is unavailable'
                : 'Couldn’t open this invitation'
          }
          message={
            message ?? 'The link may have expired. Ask a Group member for a current invitation.'
          }
        >
          {status === 'error' ? (
            <CompactButton label="Try again" variant="text" dense onPress={onRetry} />
          ) : null}
        </Banner>
        <CompactButton label="Back" variant="tonal" block onPress={onCancel} />
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <CompactText tone="secondary">A place for you, too.</CompactText>
      <Card padded>
        <View style={{ gap: 10 }}>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <CompactText accessible={false}>{descriptor.icon}</CompactText>
              <CompactText variant="overline">{descriptor.label}</CompactText>
            </View>
            <CompactText variant="title" accessibilityRole="header">
              {preview.name}
            </CompactText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="people-outline" size={18} />
              <CompactText tone="secondary">
                {preview.memberCount} {preview.memberCount === 1 ? 'member' : 'members'}
              </CompactText>
            </View>
          </View>
          <CompactText variant="small" tone="secondary">
            {alreadyMember
              ? 'You’re already a member. Open your Group to pick up where you left off.'
              : 'Opening this invitation hasn’t added you. Join when you’re ready to share this Group.'}
          </CompactText>
          {message && <Banner tone="error" message={message} />}
          <CompactButton
            label={alreadyMember ? 'Open Group' : signedIn ? 'Join Group' : 'Sign in to continue'}
            busy={joining ? 'Joining Group…' : undefined}
            block
            disabled={joining || waiting}
            hint={waiting ? joinNeedsConnection : undefined}
            onPress={alreadyMember ? onOpenGroup : onJoin}
            icon={joining ? undefined : 'arrow-forward-outline'}
          />
          {waiting && (
            <CompactText variant="small" tone="secondary" style={{ textAlign: 'center' }}>
              {joinNeedsConnection}
            </CompactText>
          )}
        </View>
      </Card>
      <CompactText variant="small" tone="secondary">
        You’ll need an account approved for the private beta. An invitation doesn’t grant account
        access.
      </CompactText>
      <CompactButton label="Not now" variant="tonal" block disabled={joining} onPress={onCancel} />
    </View>
  );
}
