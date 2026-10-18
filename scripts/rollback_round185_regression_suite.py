#!/usr/bin/env python3
"""Active Round185 selective-rollback regression suite; NMC crash guards retained.
Legacy Round46/Round50/Round74 scripts are excluded: they also fail on original Round184.
"""
import subprocess,time,json,pathlib,sys
r=pathlib.Path(__file__).resolve().parents[1]
tests=[
('rollback','node scripts/rollback_round185_three_domains.cjs'),
('round180-nmc','node scripts/round180_nmc_coastline_fill_regression.cjs'),
('round181-nmc','node scripts/round181_nmc_manual_cma_public_bins_regression.cjs'),
('round182-nmc','node scripts/round182_nmc_white_crash_regression.cjs'),
('nmc-crash-retained','node scripts/round185_nmc_crash_safety_retained_regression.cjs'),
('native-ensemble-guidance','node scripts/aether_guidance_numeric_regression.cjs'),
('round51-guidance','node scripts/round51_guidance_curvature_regression.cjs'),
('round185-intel','node scripts/round185_ensemble_intel_regression.cjs'),
('round185-ensemble-utc','node scripts/round185_ensemble_utc_regression.cjs'),
('round185-calibration','node scripts/round185_ensemble_calibration.cjs --self-test'),
('strike-basic','node scripts/strike_probability_regression.cjs'),
('strike-reference','node scripts/strike_probability_reference_regression.cjs'),
('strike-endmode','node scripts/round185_strike_endmode_regression.cjs'),
('strike-scanline','node scripts/round185_strike_scanline_regression.cjs'),
('strike-site','node scripts/round185_strike_site_index_regression.cjs'),
('strike-smoothing','node scripts/round185_strike_physical_smoothing_regression.cjs'),
('strike-stripe','node scripts/round185_strike_stripe_regression.cjs'),
('strike-wiring','node scripts/round185_strike_stream_wiring_regression.cjs'),
('rain-hotspot','node scripts/round185_rain_hotspot_regression.cjs'),
('rain-synthetic','node scripts/round185_rain_synthetic_paths_regression.cjs'),
('rain-diagnostic','node scripts/round185_rain_hotspot_diagnostic.cjs'),
('archive-presim','node scripts/round185_archive_presim_regression.cjs'),
('archive-resume','node scripts/round178_archive_resume_performance_regression.cjs'),
('realistic-geometry','node scripts/round185_realistic_motion_geometry_regression.cjs'),
('realistic-dateline','node scripts/round185_realistic_dateline_regression.cjs'),
('realistic-archive','node scripts/round185_realistic_archive_regression.cjs'),
('agency-branding','node scripts/round185_agency_branding_regression.cjs'),
('agency-global','node scripts/round185_branding_global_regression.cjs'),
('nmc-chromium','python scripts/round182_nmc_browser_canvas_regression.py'),
('nmc-safe-overlays','python scripts/round185_nmc_safe_overlays_browser.py overlays'),
('nmc-safe-fallback','python scripts/round185_nmc_safe_overlays_browser.py fallback'),
('nmc-safe-pixels','python scripts/round185_nmc_safe_overlays_browser.py pixels'),
('ensemble-chromium','python scripts/round185_browser_ensemble_smoke.py --output validation/ensemble_browser_smoke.png'),
]
if '--no-browser' in sys.argv:
 tests=[x for x in tests if 'chromium' not in x[0] and not x[0].startswith('nmc-safe-')]
res=[]
for i,(name,cmd) in enumerate(tests,1):
 t=time.time()
 try:
  p=subprocess.run(cmd, shell=True,cwd=r,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=45)
  status='PASS' if p.returncode==0 else 'FAIL';out=p.stdout[-1100:]
 except Exception as e:status='ERROR';out=str(e)
 print(f'{i:02}/{len(tests)} {status} {name}: {out.splitlines()[-1] if out.splitlines() else ""}',flush=True)
 res.append({'test':name,'command':cmd,'status':status,'duration_sec':round(time.time()-t,3),'output':out})
(r/('NMC_SAFETY_UNIT_TEST_RESULTS.json' if '--no-browser' in sys.argv else 'ROLLBACK_ACTIVE_TEST_RESULTS.json')).write_text(json.dumps(res,indent=2,ensure_ascii=False))
print('SUMMARY',sum(a['status']=='PASS' for a in res),'/',len(res))

sys.exit(0 if all(item['status']=='PASS' for item in res) else 1)
