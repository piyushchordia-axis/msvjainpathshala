/**
 * Id-bound check-in — pushed when the shikshak resumes an existing session
 * row that hasn't been checked-in yet (e.g. created earlier from the today
 * list when sessions were pre-rolled).
 */

import React from 'react';

import { CheckinScreen } from '../new/checkin';

export default function ShikshakSessionCheckin() {
  return <CheckinScreen mode="existing" />;
}
