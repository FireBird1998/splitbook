import { Fragment, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import LinkOffOutlinedIcon from '@mui/icons-material/LinkOffOutlined';
import MoveToInboxOutlinedIcon from '@mui/icons-material/MoveToInboxOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { DRAFTS_PER_REQUEST } from '@splitbook/shared/validators/expense-draft';
import { visuallyHidden } from '@/components/insights/a11y';
import MoneyText from '@/components/common/MoneyText';
import LandingFigure from '@/components/landing-figures/LandingFigure';
import { nettingStation, toReviewRack } from '@/components/landing-figures/generated';
import type { WhatsLive } from '@/lib/landing/whats-live';
import { RADIUS } from '@/lib/theme/tokens';
import { PRODUCT_NAME } from '@/lib/product';
import type { LandingSectionLink } from './LandingPage';
import LandingSection, { landingCard } from './LandingSection';

/** The section's link in the top bar, while assistants are available. */
export function assistantsSections(live: WhatsLive): LandingSectionLink[] {
  return live.assistants.available ? [{ href: '#assistants', label: 'Assistants' }] : [];
}

/** What the reading chat asks, and the first statement quotes. */
const QUESTION = 'Who still owes me for Goa?';

const andList = (items: string[]) =>
  new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(items);

function Money({ minor, currency }: { minor: number; currency: string }) {
  return (
    <MoneyText
      amount={toMajorAmount(minor, currency)}
      currency={currency}
      tone="neutral"
      color="inherit"
      sx={{ fontWeight: 600 }}
    />
  );
}

/**
 * The chat example: a reading question answered from the Settle up section's own payments, or,
 * where assistants can prepare items, the first of Fig 2's items added to To review.
 */
function chatOf(canPrepare: boolean): { you: string; reply: ReactNode } {
  if (!canPrepare) {
    const owed = nettingStation.payments.filter((payment) => payment.to === 'You');
    return {
      you: QUESTION,
      reply: (
        <>
          In Goa Weekend,{' '}
          {owed.map((payment, i) => (
            <Fragment key={payment.from}>
              {i > 0 && ' and '}
              {payment.from} owes you{' '}
              <Money minor={payment.amountMinor} currency={nettingStation.currency} />
            </Fragment>
          ))}
          .
        </>
      ),
    };
  }
  const [item] = toReviewRack.prepared;
  const { currency } = toReviewRack;
  // What the member types: whole rupees, as people write them.
  const typed = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(toMajorAmount(item.amountMinor, currency));
  const others = item.between.filter((name) => name !== 'You');
  return {
    you: `Add ${item.title[0].toLowerCase()}${item.title.slice(1)}, ${typed}. I paid, split with ${andList(others)}.`,
    reply: (
      <>
        Added 1 to To review in <strong>Goa Weekend</strong>: {item.title},{' '}
        <Money minor={item.amountMinor} currency={currency} />, paid by you, split equally between{' '}
        {item.between.length}, Tag Food. Open To review to save it.
      </>
    ),
  };
}

/** A chat bubble's corners: round, but for a small one at the bottom on its speaker's side. */
const bubbleCorners = (side: 'left' | 'right') => {
  const round = `${RADIUS.lg}px`;
  const tail = `${RADIUS.sm / 2}px`;
  return side === 'right'
    ? `${round} ${round} ${tail} ${round}`
    : `${round} ${round} ${round} ${tail}`;
};

function Chat({ canPrepare }: { canPrepare: boolean }) {
  const { you, reply } = chatOf(canPrepare);
  const bubble = { px: 2, py: 1.5, typography: 'body1' } as const;
  return (
    <Box sx={{ ...landingCard, boxShadow: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary' }}>
          <ChatBubbleOutlineOutlinedIcon fontSize="small" aria-hidden />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            In your assistant
          </Typography>
        </Stack>
        <Box
          component="p"
          sx={{
            ...bubble,
            m: 0,
            alignSelf: 'flex-end',
            maxWidth: '86%',
            borderRadius: bubbleCorners('right'),
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
          }}
        >
          <Box component="span" sx={visuallyHidden}>
            You:{' '}
          </Box>
          {you}
        </Box>
        <Box
          component="p"
          sx={{
            ...bubble,
            m: 0,
            alignSelf: 'flex-start',
            maxWidth: '92%',
            borderRadius: bubbleCorners('left'),
            bgcolor: 'surface.muted',
            color: 'text.primary',
          }}
        >
          <Box component="span" sx={visuallyHidden}>
            Claude:{' '}
          </Box>
          {reply}
        </Box>
      </Stack>
    </Box>
  );
}

/** How to connect: three steps, and a fourth where assistants can prepare items. */
function Steps({ canPrepare }: { canPrepare: boolean }) {
  const steps = [
    `Add ${PRODUCT_NAME} as a connector`,
    'Sign in and approve',
    ...(canPrepare
      ? ['Ask, or tell it what you spent', 'Review and save']
      : ['Ask about your Groups']),
  ];
  return (
    <Stack component="ol" spacing={1.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {steps.map((step, i) => (
        <Stack component="li" key={step} direction="row" spacing={1.25} alignItems="center">
          <Box
            component="span"
            sx={{
              display: 'inline-grid',
              placeItems: 'center',
              flexShrink: 0,
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: 'tint.info',
              color: 'status.info',
              typography: 'body2',
              fontWeight: 600,
            }}
          >
            {i + 1}
          </Box>
          <Typography variant="body1" component="span" sx={{ fontWeight: 600 }}>
            {step}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/** What an assistant can and can't do; the To review statements only where it can prepare items. */
function statementsOf(canPrepare: boolean) {
  return [
    {
      icon: ChatBubbleOutlineOutlinedIcon,
      title: 'Ask about your money',
      text: `“${QUESTION}” It reads your Groups, their members, Tags, Balances and spending, as you.`,
    },
    ...(canPrepare
      ? [
          {
            icon: MoveToInboxOutlinedIcon,
            title: 'Tell it what you spent',
            text: `With a separate OK, which starts switched off, it prepares up to ${DRAFTS_PER_REQUEST} items at a time in To review.`,
          },
          {
            icon: TaskAltOutlinedIcon,
            title: 'You save, never the assistant',
            text: 'You check each item and save it yourself: nothing reaches Balances until you do. A saved Expense shows “prepared by Claude” to the Group.',
          },
        ]
      : []),
    {
      icon: LinkOffOutlinedIcon,
      title: 'Stay in control',
      // True since #438: the assistant tools send members' names, never their email addresses.
      text: 'Disconnect any time in Settings. Assistants see members’ names, never their email addresses.',
    },
  ];
}

/**
 * Connected assistants (#450): how to connect Claude or ChatGPT, a chat example and what an
 * assistant can and can't do, as `live` says. Absent while assistants aren't available; covering
 * reading only until they can prepare items, when the To review statements and Fig 2 join it.
 */
export default function LandingAssistants({ live }: { live: WhatsLive }) {
  if (!live.assistants.available) return null;
  const { canPrepare } = live.assistants;
  const statements = statementsOf(canPrepare);
  return (
    <LandingSection
      id="assistants"
      eyebrow="Connected assistants"
      eyebrowColor="status.info"
      title="Talk to your Groups in Claude or ChatGPT."
      intro={
        canPrepare
          ? `Connect your ${PRODUCT_NAME} account once. Ask what you owe, or say what you spent and let the assistant prepare it for To review. Your money only moves when you say so.`
          : `Connect your ${PRODUCT_NAME} account once and ask what you owe. Nothing is saved until you say so.`
      }
    >
      <Stack spacing={{ xs: 4, md: 6 }}>
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 4, md: 7 },
            alignItems: 'center',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
          }}
        >
          <Stack spacing={3} alignItems="flex-start">
            <Steps canPrepare={canPrepare} />
            <Button variant="outlined" href="/connect/chatgpt" sx={{ minHeight: 44 }}>
              How to connect ChatGPT
            </Button>
          </Stack>
          <Chat canPrepare={canPrepare} />
        </Box>
        {canPrepare && <LandingFigure figure={toReviewRack} />}
        <Box
          component="ul"
          sx={{
            listStyle: 'none',
            p: 0,
            m: 0,
            display: 'grid',
            gap: 2,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              md: `repeat(${statements.length}, minmax(0, 1fr))`,
            },
          }}
        >
          {statements.map(({ icon: Icon, title, text }) => (
            <Box component="li" key={title} sx={landingCard}>
              <Stack spacing={1.25}>
                <Icon aria-hidden sx={{ color: 'status.info' }} />
                <Typography variant="h6" component="h3" sx={{ m: 0 }}>
                  {title}
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  {text}
                </Typography>
              </Stack>
            </Box>
          ))}
        </Box>
      </Stack>
    </LandingSection>
  );
}
