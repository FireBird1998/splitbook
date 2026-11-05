// Every shared test runs with Hermes's Intl, as Android loads this package (#863, #869).
import { installHermesIntl } from './hermes-intl';

installHermesIntl();
