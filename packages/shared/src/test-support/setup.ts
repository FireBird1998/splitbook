// Every shared test runs with Hermes's Intl, as Android loads this package (#863).
import { rejectBigIntInIntl } from './hermes-intl';

rejectBigIntInIntl();
