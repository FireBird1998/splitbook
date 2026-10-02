import { useEffect, useRef, useState, type Ref } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CURRENCIES, getCurrency } from '@splitbook/shared/currency';
import { GROUP_THEME_LIST, getGroupTheme } from '@splitbook/shared/group-themes';
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
} from './compact';
import { Copy, Icon } from './primitives';
import { fonts, useTheme } from './theme';

export type GroupCreateDraft = GroupDraft;

export interface GroupCreateFormProps {
  draft: GroupCreateDraft;
  onChange: (patch: Partial<GroupCreateDraft>) => void;
  onSubmit: () => void;
  busy: boolean;
  message: string | null;
  uncertain: boolean;
  onCheckGroups: () => void;
  onDiscard: () => void;
  /** Corrections to show now: after a field was left or a create was attempted. */
  errors?: GroupFieldErrors;
  /** Changes once per rejected create, naming the first field to correct. */
  focus?: { field: GroupField; request: number } | null;
  onLeaveField?: (field: GroupField) => void;
  /** Scrolls a field into view within the screen's ScrollView. */
  onReveal?: (section: View) => void;
}

/** A correction shown directly below the control it belongs to. */
export function FieldError({ message, ref }: { message?: string | null; ref?: Ref<View> }) {
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
}

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
  onCheckGroups,
  onDiscard,
  errors = {},
  focus = null,
  onLeaveField = () => undefined,
  onReveal = () => undefined,
}: GroupCreateFormProps) {
  const theme = useTheme();
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
  const [choosingCurrency, setChoosingCurrency] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const locked = busy || uncertain;
  const creating = 'Sending this Group. Keep this screen open until SplitBook confirms it.';
  const noun = descriptor.nouns.singular;
  const capitalizedNoun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const matchingCurrencies = CURRENCIES.filter((item) =>
    `${item.code} ${item.name}`.toLowerCase().includes(currencySearch.trim().toLowerCase()),
  );

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
          onBlur={() => onLeaveField('name')}
          maxLength={100}
          placeholder={descriptor.namePlaceholder}
          autoCapitalize="sentences"
          returnKeyType="done"
          editable={!locked}
        />
      </View>

      <View style={{ gap: 7 }}>
        <Copy style={{ fontFamily: fonts.medium, fontSize: 14 }}>Currency</Copy>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Currency, ${draft.defaultCurrency}${currency ? `, ${currency.name}` : ''}`}
          accessibilityHint="Choose the currency for this Group"
          accessibilityState={{ disabled: locked }}
          disabled={locked}
          onPress={() => {
            setCurrencySearch('');
            setChoosingCurrency(true);
          }}
          style={({ pressed }) => ({
            minHeight: 52,
            paddingHorizontal: 14,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: radius.tile,
            backgroundColor: locked || pressed ? theme.surfaceMuted : theme.surface,
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
          New expenses use this currency. Choose it before recording shared costs.
        </CompactText>
      </View>

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
            label={busy ? 'Creating your Group…' : `Create ${noun}`}
            block
            icon={busy ? undefined : 'add-outline'}
            hint={busy ? creating : undefined}
            disabled={busy}
            onPress={onSubmit}
          />
        )}
        {busy && (
          <CompactText variant="small" tone="secondary" style={{ textAlign: 'center' }}>
            {creating}
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
        visible={choosingCurrency}
        animationType="slide"
        onRequestClose={() => setChoosingCurrency(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
          <TopBar
            title="Choose currency"
            actions={
              <CompactButton
                label="Done"
                variant="text"
                dense
                onPress={() => setChoosingCurrency(false)}
              />
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
                      accessibilityRole="radio"
                      accessibilityLabel={`${item.code}, ${item.name}`}
                      accessibilityState={{ checked: item.code === draft.defaultCurrency }}
                      onPress={() => {
                        onChange({ defaultCurrency: item.code });
                        setChoosingCurrency(false);
                      }}
                      style={({ pressed }) => ({
                        minHeight: 56,
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        backgroundColor: pressed ? theme.surfaceMuted : undefined,
                      })}
                    >
                      <CompactText style={{ fontFamily: fonts.mono }}>{item.code}</CompactText>
                      <CompactText style={{ flex: 1 }}>{item.name}</CompactText>
                      {item.code === draft.defaultCurrency && (
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

export interface InvitationPreviewProps {
  preview: InvitationPreviewData | null;
  status: 'loading' | 'ready' | 'joining' | 'error' | 'invalid' | 'denied';
  message: string | null;
  alreadyMember: boolean;
  signedIn?: boolean;
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
  onJoin,
  onOpenGroup,
  onRetry,
  onCancel,
}: InvitationPreviewProps) {
  const descriptor = preview ? getGroupTheme(preview.category) : null;
  const joining = status === 'joining';
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
            label={
              joining
                ? 'Joining Group…'
                : alreadyMember
                  ? 'Open Group'
                  : signedIn
                    ? 'Join Group'
                    : 'Sign in to continue'
            }
            block
            disabled={joining}
            onPress={alreadyMember ? onOpenGroup : onJoin}
            icon={joining ? undefined : 'arrow-forward-outline'}
          />
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
