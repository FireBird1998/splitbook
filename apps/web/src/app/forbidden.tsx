import Typography from '@mui/material/Typography';
/** A member-only server page never reveals whether the requested Group exists. */
export default function ForbiddenPage() {
  return <Typography role="alert">Forbidden</Typography>;
}
