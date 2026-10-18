'use strict';
// Round150's core-repair module has been deliberately REMOVED in Round151.
// Retaining the old eligibility / correction tests would require reintroducing
// precisely the eye/eyewall post-processing the user asked us to delete.
// The new baseline-parity test below is the authoritative regression.
require('./round151_native_eye_restore_regression.cjs');
