import { useState, type Ref } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CURRENCIES, getCurrency } from '@splitbook/shared/currency';
import { GROUP_THEME_LIST, getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupDraft, InvitationPreview as InvitationPreviewModel } from '../data/types';
import { Button, Copy, Icon, Label, Loading, Notice, Panel } from './primitives';
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
}: GroupCreateFormProps) {
  const theme = useTheme();
  const descriptor = getGroupTheme(draft.category);
  const currency = getCurrency(draft.defaultCurrency);
  const [choosingCurrency, setChoosingCurrency] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const locked = busy || uncertain;
  const noun = descriptor.nouns.singular;
  const capitalizedNoun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const matchingCurrencies = CURRENCIES.filter((item) =>
    `${item.code} ${item.name}`.toLowerCase().includes(currencySearch.trim().toLowerCase()),
  );

  return (
    <View style={{ gap: 24 }}>
      <View style={{ gap: 10 }}>
        <Label>A SPACE FOR YOUR PEOPLE</Label>
        <Copy
          accessibilityRole="header"
          style={{ fontFamily: fonts.semibold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 }}
        >
          Create a Group
        </Copy>
        <Copy style={{ color: theme.textSecondary }}>
          Choose a Theme, name it, then invite the people you share with.
        </Copy>
      </View>

      {uncertain && (
        <Panel>
          <Icon name="help-circle-outline" color={theme.brand.main} size={28} />
          <Copy accessibilityRole="header" style={{ fontFamily: fonts.semibold, fontSize: 21 }}>
            Your Group may already exist
          </Copy>
          <Copy style={{ color: theme.textSecondary }}>
            We couldn’t confirm whether it was created. Your entries are kept here. Check your
            Groups before creating another one.
          </Copy>
          <Button label="Check my Groups" onPress={onCheckGroups} disabled={busy} />
        </Panel>
      )}

      <View style={{ gap: 12 }}>
        <Copy style={{ fontFamily: fonts.semibold }}>Theme</Copy>
        <View
          accessibilityRole="radiogroup"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}
        >
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
                  flexBasis: '45%',
                  flexGrow: 1,
                  minHeight: 64,
                  paddingHorizontal: 14,
                  paddingVertical: 13,
                  borderWidth: 1,
                  borderColor: selected ? theme.brand.main : theme.border,
                  borderRadius: 14,
                  backgroundColor: selected ? theme.brand.bg : theme.surface,
                  opacity: locked ? 0.65 : pressed ? 0.75 : 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 9,
                })}
              >
                <Copy accessible={false}>{option.icon}</Copy>
                <Copy style={{ flex: 1, fontFamily: selected ? fonts.semibold : fonts.regular }}>
                  {option.label}
                </Copy>
                {selected && <Icon name="checkmark-circle" size={18} color={theme.brand.main} />}
              </Pressable>
            );
          })}
        </View>
        <Copy style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
          {descriptor.tagline}
        </Copy>
      </View>

      <Field
        label={`${capitalizedNoun} name`}
        value={draft.name}
        onChangeText={(name) => onChange({ name })}
        maxLength={100}
        placeholder={descriptor.namePlaceholder}
        autoCapitalize="sentences"
        returnKeyType="done"
        editable={!locked}
      />

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
            minHeight: 56,
            padding: 15,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 12,
            backgroundColor: theme.surface,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            opacity: locked ? 0.65 : pressed ? 0.75 : 1,
          })}
        >
          <Copy style={{ fontFamily: fonts.mono }}>{draft.defaultCurrency}</Copy>
          <Copy style={{ color: theme.textSecondary, flex: 1 }}>{currency?.name}</Copy>
          <Icon name="chevron-down-outline" size={18} />
        </Pressable>
        <Copy style={{ fontSize: 13, lineHeight: 19, color: theme.textSecondary }}>
          New expenses use this currency. Choose it before recording shared costs.
        </Copy>
      </View>

      {descriptor.dates === 'bounded' && (
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Icon name="calendar-outline" color={theme.brand.main} size={20} />
            <Copy style={{ fontFamily: fonts.semibold }}>Trip dates</Copy>
          </View>
          <Copy style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
            Optional. Leave these blank if your plans are still taking shape.
          </Copy>
          <Field
            label="Start date"
            value={draft.startDate}
            onChangeText={(startDate) => onChange({ startDate })}
            placeholder="YYYY-MM-DD"
            hint="Year-month-day, for example 2026-10-15."
            autoCorrect={false}
            autoCapitalize="none"
            maxLength={10}
            returnKeyType="done"
            editable={!locked}
          />
          <Field
            label="End date"
            value={draft.endDate}
            onChangeText={(endDate) => onChange({ endDate })}
            placeholder="YYYY-MM-DD"
            hint="On or after the start date."
            autoCorrect={false}
            autoCapitalize="none"
            maxLength={10}
            returnKeyType="done"
            editable={!locked}
          />
        </Panel>
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

      {message && (
        <Copy accessibilityRole="alert" style={{ color: theme.status.negative }}>
          {message}
        </Copy>
      )}
      <View style={{ gap: 10 }}>
        {!uncertain && (
          <Button
            label={busy ? 'Creating your Group…' : `Create ${noun}`}
            icon={busy ? undefined : 'add-outline'}
            disabled={busy || !draft.name.trim() || !currency}
            onPress={onSubmit}
          />
        )}
        <Button
          label={uncertain ? 'Leave this form' : 'Cancel'}
          secondary
          disabled={busy}
          onPress={onDiscard}
        />
        <Copy
          style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' }}
        >
          You’ll be the first member and Group admin. Invite others after creation.
        </Copy>
      </View>

      <Modal
        visible={choosingCurrency}
        animationType="slide"
        onRequestClose={() => setChoosingCurrency(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
          <View style={{ padding: 24, gap: 18 }}>
            <Copy
              accessibilityRole="header"
              style={{ fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34 }}
            >
              Choose currency
            </Copy>
            <Field
              label="Search currencies"
              value={currencySearch}
              onChangeText={setCurrencySearch}
              placeholder="Currency name or code"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="done"
            />
            <Button label="Done" secondary onPress={() => setChoosingCurrency(false)} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}
          >
            {matchingCurrencies.map((item) => (
              <Pressable
                key={item.code}
                accessibilityRole="radio"
                accessibilityLabel={`${item.code}, ${item.name}`}
                accessibilityState={{ checked: item.code === draft.defaultCurrency }}
                onPress={() => {
                  onChange({ defaultCurrency: item.code });
                  setChoosingCurrency(false);
                }}
                style={({ pressed }) => ({
                  minHeight: 64,
                  paddingVertical: 16,
                  borderBottomWidth: 1,
                  borderColor: theme.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 16,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Copy style={{ fontFamily: fonts.mono }}>{item.code}</Copy>
                <Copy style={{ flex: 1 }}>{item.name}</Copy>
                {item.code === draft.defaultCurrency && (
                  <Icon name="checkmark" color={theme.brand.main} />
                )}
              </Pressable>
            ))}
            {!matchingCurrencies.length && (
              <Copy style={{ color: theme.textSecondary }}>No currencies match your search.</Copy>
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
  const theme = useTheme();
  const descriptor = preview ? getGroupTheme(preview.category) : null;
  const joining = status === 'joining';
  if (status === 'loading') {
    return (
      <View style={{ gap: 16 }}>
        <Loading label="Opening your invitation…" />
        <Button label="Cancel" secondary onPress={onCancel} />
      </View>
    );
  }
  if (!preview || !descriptor || ['invalid', 'denied', 'error'].includes(status)) {
    return (
      <View style={{ gap: 16 }}>
        <Notice
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
          icon={status === 'error' ? 'cloud-offline-outline' : 'lock-closed-outline'}
          retry={status === 'error' ? onRetry : undefined}
        />
        <Button label="Back" secondary onPress={onCancel} />
      </View>
    );
  }
  return (
    <View style={{ gap: 24 }}>
      <View style={{ gap: 12 }}>
        <Label>YOU’RE INVITED</Label>
        <Copy
          accessibilityRole="header"
          style={{ fontFamily: fonts.semibold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 }}
        >
          A place for you, too.
        </Copy>
      </View>
      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Copy accessible={false} style={{ fontSize: 26, lineHeight: 32 }}>
            {descriptor.icon}
          </Copy>
          <Label>{descriptor.label.toUpperCase()}</Label>
        </View>
        <Copy
          accessibilityRole="header"
          style={{ fontFamily: fonts.semibold, fontSize: 27, lineHeight: 34 }}
        >
          {preview.name}
        </Copy>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Icon name="people-outline" size={18} />
          <Copy style={{ color: theme.textSecondary }}>
            {preview.memberCount} {preview.memberCount === 1 ? 'member' : 'members'}
          </Copy>
        </View>
        <Copy style={{ color: theme.textSecondary }}>
          {alreadyMember
            ? 'You’re already a member. Open your Group to pick up where you left off.'
            : 'Opening this invitation hasn’t added you. Join when you’re ready to share this Group.'}
        </Copy>
        {message && (
          <Copy accessibilityRole="alert" style={{ color: theme.status.negative }}>
            {message}
          </Copy>
        )}
        <Button
          label={
            joining
              ? 'Joining Group…'
              : alreadyMember
                ? 'Open Group'
                : signedIn
                  ? 'Join Group'
                  : 'Sign in to continue'
          }
          disabled={joining}
          onPress={alreadyMember ? onOpenGroup : onJoin}
          icon={joining ? undefined : 'arrow-forward-outline'}
        />
      </Panel>
      <Copy style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 20 }}>
        You’ll need an account approved for the private beta. An invitation doesn’t grant account
        access.
      </Copy>
      <Button label="Not now" secondary disabled={joining} onPress={onCancel} />
    </View>
  );
}

export interface InviteSharePanelProps {
  status: 'idle' | 'loading' | 'ready' | 'error';
  message: string | null;
  url: string | null;
  onShare: () => void;
  onLoad: () => void;
}

export function InviteSharePanel({ status, message, url, onShare, onLoad }: InviteSharePanelProps) {
  const theme = useTheme();
  const loading = status === 'loading';
  return (
    <Panel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <Icon name="person-add-outline" color={theme.brand.main} size={20} />
        <Label>INVITE PEOPLE</Label>
      </View>
      <Copy
        accessibilityRole="header"
        style={{ fontFamily: fonts.semibold, fontSize: 22, lineHeight: 29 }}
      >
        Bring your people in
      </Copy>
      <Copy style={{ color: theme.textSecondary }}>
        Share a link so someone can preview this Group and choose to join.
      </Copy>
      {loading && (
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
        >
          <ActivityIndicator color={theme.brand.main} />
          <Copy style={{ color: theme.textSecondary, flex: 1 }}>Checking your invite link…</Copy>
        </View>
      )}
      {message && (
        <Copy accessibilityRole="alert" style={{ color: theme.status.negative }}>
          {message}
        </Copy>
      )}
      {status === 'ready' && url ? (
        <>
          <Copy
            selectable
            style={{
              fontFamily: fonts.mono,
              fontSize: 12,
              lineHeight: 20,
              color: theme.textSecondary,
            }}
          >
            {url}
          </Copy>
          <Button label="Share invite link" icon="share-social-outline" onPress={onShare} />
          <Copy style={{ fontSize: 13, lineHeight: 19, color: theme.textSecondary }}>
            Choose an app and a recipient in Android’s share menu.
          </Copy>
        </>
      ) : (
        <Button
          label={
            loading
              ? 'Checking invite link…'
              : status === 'error'
                ? 'Check invite link'
                : 'Get invite link'
          }
          disabled={loading}
          secondary
          onPress={onLoad}
        />
      )}
    </Panel>
  );
}
