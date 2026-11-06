import type { ReactTestInstance } from 'react-test-renderer';
import { ConfirmSheet } from '../ui/compact';

const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;

/**
 * The ConfirmSheet open under `root`, read and answered as a member does (#646): its red action,
 * its Cancel or Keep in the header, Android Back, or a tap outside. Throws unless exactly one is
 * open.
 */
export function confirmSheetIn(root: ReactTestInstance) {
  const sheets = root.findAllByType(ConfirmSheet);
  if (sheets.length !== 1) throw new Error(`Expected one open confirm sheet, not ${sheets.length}`);
  const sheet = sheets[0]!;
  const props = sheet.props as Parameters<typeof ConfirmSheet>[0];
  const modal = sheet.find((node) => isHost(node, 'Modal'));
  const buttons = sheet.findAll(
    (node) => isHost(node, 'Pressable') && node.props.accessibilityRole === 'button',
  );
  // In order: the scrim, the header's Cancel or Keep, then the red action in the footer.
  const [scrim, header] = buttons;
  const action = buttons.at(-1)!;
  return {
    title: props.title,
    message: props.message,
    action: props.action,
    cancel: props.cancel,
    modal,
    heading: sheet.find(
      (node) => isHost(node, 'Text') && node.props.accessibilityRole === 'header',
    ),
    /** Every button's spoken label, in order. */
    labels: buttons.map((button) => button.props.accessibilityLabel as string),
    /** The red action, as a ReactTestInstance, for its colours and state. */
    actionButton: action,
    pressAction: () => action.props.onPress(),
    pressCancel: () => header!.props.onPress(),
    pressBack: () => modal.props.onRequestClose(),
    pressOutside: () => scrim!.props.onPress(),
  };
}

/** Whether a ConfirmSheet is open under `root`. */
export const confirmSheetOpen = (root: ReactTestInstance) =>
  root.findAllByType(ConfirmSheet).length > 0;
