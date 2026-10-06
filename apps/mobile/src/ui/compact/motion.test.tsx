import { Profiler, type ReactElement } from 'react';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { flatten, layoutHeight } from '../../test-utils/layout';
import { loop, setReduceMotion, setWindow, timing } from '../../test-utils/native';

// #331: the loading pieces move on the native driver, together, and only while they're shown;
// with reduce motion on, nothing moves. The stand-ins never run an animation, so these tests
// check what was started, with what, and what was stopped, never how far anything got.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  Card,
  CompactButton,
  CompactText,
  LinearProgress,
  Skeleton,
  SkeletonRows,
  StatusText,
  SummaryStats,
  motion,
  pulseOpacity,
  sweepTrack,
} = await import('./index');
const light = getSemanticTokens('light');

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  // Every test unmounts what it rendered, so no loop outlives it.
  act(() => renderer?.unmount());
  renderer = undefined;
});

/** Renders, then lets Android answer whether reduce motion is on. */
async function render(element: ReactElement) {
  act(() => {
    renderer = create(element);
  });
  await answered();
  return renderer!.root;
}
const answered = () => act(async () => undefined);
const update = (element: ReactElement) => act(() => renderer!.update(element));
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const hosts = (root: ReactTestInstance, name: string) => root.findAll((node) => isHost(node, name));
const style = (node: ReactTestInstance) => flatten(node.props.style);
/** The animations the stand-ins handed out, as the calls' results. */
const loops = () => loop.mock.results.map((result) => result.value);
const timings = () => timing.mock.results.map((result) => result.value);
/** Content fading in, apart from the skeleton pulse any placeholder starts. */
const fades = () => timings().filter((fade) => fade.config.duration === motion.reveal);
/** Skeleton blocks: the shapes that breathe. */
const blocks = (root: ReactTestInstance) =>
  hosts(root, 'AnimatedView').filter((node) => style(node).backgroundColor === light.border);
const text = (root: ReactTestInstance) =>
  hosts(root, 'Text')
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' ');

describe('Skeletons breathe together', () => {
  it('share one pulse on the native driver, in the border colour, while any is shown', async () => {
    const root = await render(
      <>
        <Skeleton width={40} height={40} />
        <Skeleton width="60%" line="body" />
        <SkeletonRows label="Loading your Groups" rows={2} />
      </>,
    );
    // One loop for every block on screen, so they move in step.
    expect(loop).toHaveBeenCalledOnce();
    const [pulse] = loops();
    expect(pulse.animation.config).toMatchObject({
      toValue: 1,
      duration: motion.pulse,
      useNativeDriver: true,
    });
    expect(pulse.start).toHaveBeenCalledOnce();
    const opacities = new Set(blocks(root).map((node) => style(node).opacity));
    expect(blocks(root).length).toBeGreaterThan(4);
    expect(opacities.size).toBe(1);
    // It breathes between half and full strength over the border colour.
    const [opacity] = opacities as Set<{ interpolation: { outputRange: number[] } }>;
    expect(opacity.interpolation.outputRange).toEqual([pulseOpacity.rest, pulseOpacity.peak]);
  });

  it('stops only when the last skeleton goes', async () => {
    await render(
      <>
        <Skeleton width={40} />
        <Skeleton width={60} />
      </>,
    );
    const [pulse] = loops();
    update(<Skeleton width={40} />);
    expect(pulse.stop).not.toHaveBeenCalled();
    update(<CompactText>Loaded</CompactText>);
    expect(pulse.stop).toHaveBeenCalledOnce();
    // Shown again, a new loop starts.
    update(<Skeleton width={40} />);
    expect(loop).toHaveBeenCalledTimes(2);
  });

  it('stops when the screen unmounts', async () => {
    await render(<SkeletonRows label="Loading Activity" avatar />);
    const [pulse] = loops();
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(pulse.stop).toHaveBeenCalledOnce();
  });
});

describe('The progress bar sweeps', () => {
  const segment = (root: ReactTestInstance) => hosts(root, 'AnimatedView')[0];

  it('a brand segment across its brand-tinted track, on the native driver, while shown', async () => {
    const root = await render(<LinearProgress label="Loading September" />);
    const track = root.find((node) => node.props.accessibilityRole === 'progressbar');
    expect(isHost(track, 'View')).toBe(true);
    expect(style(track).backgroundColor).toBe(light.brand.bg);
    expect(style(segment(root))).toMatchObject({
      backgroundColor: light.brand.main,
      width: `${sweepTrack.segment * 100}%`,
    });
    expect(loop).toHaveBeenCalledOnce();
    const [sweep] = loops();
    expect(sweep.animation.config).toMatchObject({
      toValue: sweepTrack.to,
      duration: motion.sweep,
      useNativeDriver: true,
    });
    // The offset is a fraction of the track, times the track's width from its layout.
    const [{ translateX }] = style(segment(root)).transform as [
      { translateX: { multiply: [{ value: number }, { value: number }] } },
    ];
    const [at, width] = translateX.multiply;
    expect(at.value).toBe(sweepTrack.from);
    act(() => track.props.onLayout({ nativeEvent: { layout: { width: 296 } } }));
    expect(width.value).toBe(296);
  });

  it('stops when it goes', async () => {
    await render(<LinearProgress label="Loading September" />);
    const [sweep] = loops();
    update(<CompactText>Loaded</CompactText>);
    expect(sweep.stop).toHaveBeenCalledOnce();
  });
});

describe('Content takes its placeholder’s place', () => {
  const placeholder = <Card loading="Loading your Groups" />;
  const content = (
    <Card>
      <CompactText>Maple House</CompactText>
    </Card>
  );
  const body = (root: ReactTestInstance) => hosts(root, 'AnimatedView').at(-1)!;

  it('fades in on the native driver when the Card stops loading', async () => {
    const root = await render(placeholder);
    const busy = root.findAll((node) => node.props.accessibilityLabel === 'Loading your Groups');
    expect(busy.map((node) => node.props.accessibilityState)).toEqual([{ busy: true }]);
    timing.mockClear();
    update(content);
    expect(root.findAll((node) => node.props.accessibilityLabel === 'Loading your Groups')).toEqual(
      [],
    );
    expect(text(root)).toBe('Maple House');
    const [fade] = timings();
    expect(style(body(root)).opacity).toBe(fade.value);
    expect(fade.value.value).toBe(0);
    expect(fade.config).toMatchObject({
      toValue: 1,
      duration: motion.reveal,
      useNativeDriver: true,
    });
    expect(fade.start).toHaveBeenCalledOnce();
  });

  it('stops the fade when it unmounts, or loads again', async () => {
    await render(placeholder);
    update(content);
    const [fade] = fades();
    update(placeholder);
    expect(fade.stop).toHaveBeenCalledOnce();
    update(content);
    const [, again] = fades();
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(again.stop).toHaveBeenCalledOnce();
  });

  it('leaves a Card that never loaded exactly as it was', async () => {
    const root = await render(content);
    expect(hosts(root, 'AnimatedView')).toEqual([]);
    update(
      <Card>
        <CompactText>Lisbon Offsite</CompactText>
      </Card>,
    );
    expect(timing).not.toHaveBeenCalled();
  });

  it('the summary’s stats too, hidden from screen readers while they load', async () => {
    const stats = [{ label: 'Spent', value: '₹18,420.00' }];
    const root = await render(<SummaryStats stats={[]} loading />);
    const hidden = root.findAll((node) => node.props.accessibilityElementsHidden === true);
    expect(hidden.length).toBeGreaterThan(0);
    expect(root.findAll((node) => node.props.accessible === true)).toEqual([]);
    timing.mockClear();
    update(<SummaryStats stats={stats} />);
    expect(
      root.findAll((node) => node.props.accessibilityLabel === 'Spent: ₹18,420.00'),
    ).toHaveLength(1);
    const [fade] = timings();
    expect(fade.value.value).toBe(0);
    expect(fade.config).toMatchObject({ toValue: 1, useNativeDriver: true });
  });
});

describe('Reduce motion', () => {
  it('keeps skeletons and the progress bar still, and shows content at once', async () => {
    setReduceMotion(true);
    const root = await render(
      <>
        <LinearProgress label="Loading September" />
        <Card loading="Loading September 2026 expenses" />
      </>,
    );
    expect(loop).not.toHaveBeenCalled();
    // The segment rests where the still bar always sat.
    const [segment] = hosts(root, 'AnimatedView');
    const [{ translateX }] = style(segment).transform as [
      { translateX: { multiply: [{ value: number }] } },
    ];
    expect(translateX.multiply[0].value).toBe(sweepTrack.rest);
    update(
      <>
        <LinearProgress label="Loading September" />
        <Card>
          <CompactText>Weekly groceries</CompactText>
        </Card>
      </>,
    );
    expect(timing).not.toHaveBeenCalled();
    const body = hosts(root, 'AnimatedView').at(-1)!;
    expect((style(body).opacity as { value: number }).value).toBe(1);
  });

  it('stops what moves when it turns on, and starts it again when it turns off', async () => {
    await render(
      <>
        <Skeleton width={40} />
        <LinearProgress label="Loading September" />
      </>,
    );
    const running = loops();
    expect(running).toHaveLength(2);
    act(() => setReduceMotion(true));
    for (const animation of running) expect(animation.stop).toHaveBeenCalledOnce();
    act(() => setReduceMotion(false));
    expect(loop).toHaveBeenCalledTimes(4);
  });

  it('a busy button shows a still mark instead of a spinner', async () => {
    setReduceMotion(true);
    const root = await render(
      <CompactButton label="Save expense" busy="Saving expense…" block onPress={vi.fn()} />,
    );
    expect(hosts(root, 'ActivityIndicator')).toEqual([]);
    expect(hosts(root, 'Ionicons').map((node) => node.props.name)).toContain('hourglass-outline');
  });

  it('changes a status at once', async () => {
    setReduceMotion(true);
    const root = await render(<StatusText>Updated 10:42</StatusText>);
    update(<StatusText>Saved 10:42 · refreshing</StatusText>);
    expect(hosts(root, 'AnimatedText')).toEqual([]);
    expect(timing).not.toHaveBeenCalled();
  });
});

describe('Nothing re-renders React while it moves', () => {
  it('starting, stopping and resting the loops commits nothing', async () => {
    const commits = vi.fn();
    const tree = (
      <Profiler id="loading" onRender={commits}>
        <LinearProgress label="Loading September" />
        <Card loading="Loading your Groups" />
        <StatusText>Updated 10:42</StatusText>
      </Profiler>
    );
    act(() => {
      renderer = create(tree);
    });
    expect(commits).toHaveBeenCalledOnce();
    await answered();
    const track = renderer!.root.find((node) => node.props?.accessibilityRole === 'progressbar');
    act(() => track.props.onLayout({ nativeEvent: { layout: { width: 320 } } }));
    act(() => setReduceMotion(true));
    act(() => setReduceMotion(false));
    expect(loop.mock.calls.length).toBeGreaterThan(0);
    expect(commits).toHaveBeenCalledOnce();
  });
});

describe('A busy button', () => {
  const save = (busy?: string) => (
    <CompactButton
      label="Save expense"
      amount="₹1,249.50"
      busy={busy}
      block
      disabled={busy !== undefined}
      hint={busy ? 'Sending this Expense.' : undefined}
      onPress={vi.fn()}
    />
  );
  const button = (root: ReactTestInstance) => root.find((node) => isHost(node, 'Pressable'));
  const json = () => renderer!.toJSON() as ReactTestRendererJSON;

  it('says what it’s doing beside a spinner, and announces it busy', async () => {
    const root = await render(save());
    expect(button(root).props.accessibilityLabel).toBe('Save expense ₹1,249.50');
    expect(button(root).props.accessibilityState).toEqual({ disabled: false });
    expect(hosts(root, 'ActivityIndicator')).toEqual([]);
    update(save('Saving expense…'));
    expect(button(root).props.accessibilityLabel).toBe('Saving expense…');
    expect(button(root).props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(button(root).props.accessibilityHint).toBe('Sending this Expense.');
    expect(button(root).props.disabled).toBe(true);
    const [spinner] = hosts(root, 'ActivityIndicator');
    expect(spinner.props.color).toBe(light.brand.contrastText);
    expect(text(root)).toContain('Saving expense…');
    // It works at full strength: busy isn't unavailable.
    expect(style(button(root)).opacity).toBe(1);
  });

  it('keeps its size: the label stays laid out underneath, unseen and unread', async () => {
    const root = await render(save());
    const idle = layoutHeight(json());
    const idleChildren = hosts(root, 'Text').map((node) => node.children.join(''));
    update(save('Saving expense…'));
    expect(layoutHeight(json())).toBe(idle);
    expect(style(button(root))).toMatchObject({ alignSelf: 'stretch', minHeight: 48 });
    const underneath = button(root).children[0] as ReactTestInstance;
    expect(style(underneath).opacity).toBe(0);
    expect(underneath.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(hosts(underneath, 'Text').map((node) => node.children.join(''))).toEqual(idleChildren);
    // The busy label sits over it, and can't push it wider.
    const over = button(root).children[1] as ReactTestInstance;
    expect(style(over)).toMatchObject({ position: 'absolute', left: 0, right: 0 });
    setWindow({ fontScale: 1.3 });
    update(save('Saving expense…'));
    const large = layoutHeight(json(), 1.3);
    update(save());
    expect(layoutHeight(json(), 1.3)).toBe(large);
  });
});

describe('A status change cross-fades', () => {
  it('the old text fades out where it was as the new one fades in', async () => {
    const root = await render(<StatusText>Updated 10:42</StatusText>);
    expect(hosts(root, 'AnimatedText')).toEqual([]);
    update(<StatusText>Saved 10:42 · refreshing</StatusText>);
    // Screen readers, and tests, read only the current text.
    expect(text(root)).toBe('Saved 10:42 · refreshing');
    const [outgoing] = hosts(root, 'AnimatedText');
    expect(outgoing.children).toEqual(['Updated 10:42']);
    expect(outgoing.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(style(outgoing).position).toBe('absolute');
    const [fade] = timings();
    expect(fade.config).toMatchObject({
      toValue: 1,
      duration: motion.status,
      useNativeDriver: true,
    });
    expect(fade.value.value).toBe(0);
    // Both run off the one fade: the outgoing copy takes its reverse.
    expect((style(outgoing).opacity as { of: unknown }).of).toBe(fade.value);
  });
});
