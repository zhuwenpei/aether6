import React, { useEffect, useMemo, useState } from 'react';
import { AppState, createCloudCompositorInitialState } from '../types';
import Step0Ratio from './Step0Ratio';
import Step1Target from './Step1Target';
import Step2Typhoon from './Step2Typhoon';
import Step3Params from './Step3Params';
import Step4Export from './Step4Export';

interface Props {
  targetLat: number;
  targetLon: number;
  initialDate?: string;
}

export default function Wizard({ targetLat, targetLon, initialDate }: Props) {
  const initialState = useMemo(
    () => createCloudCompositorInitialState(targetLat, targetLon, initialDate),
    [targetLat, targetLon, initialDate]
  );
  const [state, setState] = useState<AppState>(initialState);

  // Reopening the compositor at another simulation hour must use that hour's
  // cyclone centre rather than a stale target retained from the previous session.
  useEffect(() => {
    setState(initialState);
  }, [initialState]);

  const updateState = (updates: Partial<AppState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  };

  const nextStep = () => setState((prev) => ({ ...prev, step: prev.step + 1 }));
  const prevStep = () => setState((prev) => ({ ...prev, step: Math.max(0, prev.step - 1) }));
  const reset = () => setState(createCloudCompositorInitialState(targetLat, targetLon, initialDate));

  return (
    <div className="cloud-compositor-wizard w-full mx-auto h-full bg-slate-50 flex flex-col shadow-xl overflow-hidden relative">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {state.step === 0 && <Step0Ratio state={state} updateState={updateState} onNext={nextStep} />}
        {state.step === 1 && <Step1Target state={state} updateState={updateState} onNext={nextStep} onPrev={prevStep} />}
        {state.step === 2 && <Step2Typhoon state={state} updateState={updateState} onNext={nextStep} onPrev={prevStep} />}
        {state.step === 3 && <Step3Params state={state} updateState={updateState} onNext={nextStep} onPrev={prevStep} />}
        {state.step === 4 && <Step4Export state={state} onPrev={prevStep} onReset={reset} />}
      </div>
    </div>
  );
}
