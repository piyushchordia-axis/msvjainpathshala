import JoinCompletePaymentPage from './JoinCompletePaymentPage';

/**
 * Students only. A fee is charged for MSV registration alone — seva as a Guruji
 * or Sanchalak carries none, so those journeys have no payment route.
 */
export function StudentCompletePaymentPage() {
  return <JoinCompletePaymentPage kind="student" />;
}
