// The Advanced Driving Base's ready-made tools (LEGO's own, rebuilt from their building instructions), shared by the
// robot builder and the default robot.
// Ready-made tools for a chassis without the arm bracket: real builds the child can use as they are or change ("My
// own" from there). The Advanced Driving Base's back lift arm: a 12-long axle across the back frame's side holes, over
// motor C's 28-tooth gear, carries a 20-tooth gear meshing with it (28:20, so the arm turns 1.4 times as far as the
// motor, the other way); a 2-long liftarm locked on the axle's left end and a 9-long beam pinned to it reach out behind
// the robot.
export const TOOL_PRESETS = {
  advanced: [
    // LEGO's Lift Arm for the Advanced Driving Base (its building instructions, steps 1-22), on the front tool frame: motor D's
    // 28-tooth gear turns a 36-tooth gear on an upright axle, whose 12-tooth gear turns two 20-tooth gears on the arm's 9-long axle
    { id: 'lift-arm', port: 'D', label: 'Lift arm', note: 'LEGO\'s Lift Arm on motor D: a long arm out the front with a rack at its tip (28:36 then 12:20 gears, so it turns about half as far as the motor)',
      ldr: `1 0 0 -168.7646 -120 0 0 1 0 1 0 -1 0 0 64179.dat
1 26 -20 -168.7646 -120 1 0 0 0 1 0 0 0 1 39793.dat
1 0 10 -168.7646 -140 1 0 0 0 1 0 0 0 1 61332.dat
1 0 10 -168.7646 -100 1 0 0 0 1 0 0 0 1 61332.dat
1 14 30 -168.7646 -140 1 0 0 0 1 0 0 0 1 62462.dat
1 14 30 -168.7646 -100 1 0 0 0 1 0 0 0 1 62462.dat
1 1 -60 -168.7646 -140 1 0 0 0 1 0 0 0 1 6558.dat
1 1 -60 -168.7646 -100 1 0 0 0 1 0 0 0 1 6558.dat
1 1 60 -168.7646 -140 1 0 0 0 1 0 0 0 1 6558.dat
1 1 60 -168.7646 -100 1 0 0 0 1 0 0 0 1 6558.dat
1 0 -20 -168.7646 -120 0 1 0 -1 0 0 0 0 1 3705.dat
1 0 -20 -148.7646 -120 1 0 0 0 0 -1 0 1 0 32498.dat
1 0 -20 -188.7646 -120 1 0 0 0 0 -1 0 1 0 32270.dat
1 14 -20 -203.7646 -120 1 0 0 0 0 -1 0 1 0 32123b.dat
1 14 -80 -208.7646 -120 0 1 0 0 0 1 1 0 0 60484.dat
1 14 80 -208.7646 -120 0 1 0 0 0 1 1 0 0 60484.dat
1 71 0 -208.7646 -120 1 0 0 0 1 0 0 0 1 60485.dat
1 19 -60 -208.7646 -120 0 0 1 0 1 0 -1 0 0 18575.dat
1 19 -40 -208.7646 -120 0 0 1 0 1 0 -1 0 0 18575.dat
1 71 40 -208.7646 -120 0 0 1 0 1 0 -1 0 0 3713.dat
1 71 60 -208.7646 -120 0 0 1 0 1 0 -1 0 0 3713.dat
1 0 -20 -208.7646 -120 0 1 0 1 0 0 0 0 -1 32348.dat
1 0 20 -208.7646 -120 0 1 0 1 0 0 0 0 -1 32348.dat
1 4 0 -228.7646 -120 1 0 0 0 -1 0 0 0 -1 42003.dat
1 0 0 -248.7646 -110 0 1 0 0 0 -1 -1 0 0 6628.dat
1 1 0 -208.7646 -180 1 0 0 0 1 0 0 0 1 6558.dat
1 1 0 -176.7646 -204 1 0 0 0 1 0 0 0 1 6558.dat
1 0 0 -144.7646 -228 0 1 0 -0.6 0 -0.8 -0.8 0 0.6 40490.dat
1 1 0 -112.7646 -252 1 0 0 0 1 0 0 0 1 6558.dat
1 1 0 -80.7646 -276 1 0 0 0 1 0 0 0 1 6558.dat
1 0 -20 -128.7646 -240 0 -1 0 -0.6 0 0.8 -0.8 0 -0.6 32348.dat
1 0 20 -128.7646 -240 0 -1 0 -0.6 0 0.8 -0.8 0 -0.6 32348.dat
1 14 0 -80.7646 -336 1 0 0 0 1 0 0 0 1 4519.dat
1 0 0 -80.7646 -376 0 0 1 0 -1 0 1 0 0 87761.dat
` },
    // LEGO's Dozer Blade (its building instructions, steps 1-26) on the back tool frame: the same gear train from motor C's
    // 28-tooth gear, turning a 15-long axle (a 9 and a 6 joined) that carries two doubled curved racks down to the blade
    { id: 'dozer', port: 'C', label: 'Dozer blade', note: 'LEGO\'s Dozer Blade on motor C: two curved arms from the back frame down to a blade behind the robot (28:36 then 12:20 gears)',
      ldr: `1 0 0 -169.7646 190 0 0 1 0 1 0 -1 0 0 64179.dat
1 26 20 -169.7646 190 1 0 0 0 1 0 0 0 1 39793.dat
1 0 -10 -169.7646 170 1 0 0 0 1 0 0 0 1 61332.dat
1 0 -10 -169.7646 210 1 0 0 0 1 0 0 0 1 61332.dat
1 14 -30 -169.7646 170 1 0 0 0 1 0 0 0 1 62462.dat
1 14 -30 -169.7646 210 1 0 0 0 1 0 0 0 1 62462.dat
1 1 -60 -169.7646 170 1 0 0 0 1 0 0 0 1 6558.dat
1 1 -60 -169.7646 210 1 0 0 0 1 0 0 0 1 6558.dat
1 1 60 -169.7646 170 1 0 0 0 1 0 0 0 1 6558.dat
1 1 60 -169.7646 210 1 0 0 0 1 0 0 0 1 6558.dat
1 0 20 -169.7646 190 0 1 0 -1 0 0 0 0 1 3705.dat
1 0 20 -149.7646 190 1 0 0 0 0 -1 0 1 0 32498.dat
1 0 20 -189.7646 190 1 0 0 0 0 -1 0 1 0 32270.dat
1 14 20 -204.7646 190 1 0 0 0 0 -1 0 1 0 32123b.dat
1 14 -80 -209.7646 190 0 1 0 0 0 1 1 0 0 60484.dat
1 14 80 -209.7646 190 0 1 0 0 0 1 1 0 0 60484.dat
1 71 60 -209.7646 190 1 0 0 0 1 0 0 0 1 60485.dat
1 4 -90 -209.7646 190 1 0 0 0 1 0 0 0 1 3706.dat
1 15 -30 -209.7646 190 0 0 -1 0 1 0 1 0 0 59443.dat
1 4 0 -229.7646 190 1 0 0 0 -1 0 0 0 -1 42003.dat
1 0 0 -249.7646 200 0 1 0 0 0 -1 -1 0 0 6628.dat
1 19 60 -209.7646 190 0 0 1 0 1 0 -1 0 0 18575.dat
1 19 40 -209.7646 190 0 0 1 0 1 0 -1 0 0 18575.dat
1 71 20 -209.7646 190 0 0 1 0 1 0 -1 0 0 3713.dat
1 71 100 -209.7646 190 0 0 1 0 1 0 -1 0 0 3713.dat
1 71 -100 -209.7646 190 0 0 1 0 1 0 -1 0 0 3713.dat
1 0 -120 -9.7646 190 0 -1 0 1 0 0 0 0 1 24121.dat
1 0 -140 -9.7646 190 0 1 0 0 0 -1 -1 0 0 24121.dat
1 71 -130 -182.9697 290 1 0 0 0 1 0 0 0 1 3673.dat
1 71 -130 -109.7646 363.2051 1 0 0 0 1 0 0 0 1 3673.dat
1 4 -130 -9.7646 390 1 0 0 0 1 0 0 0 1 32062.dat
1 4 -130 -9.7646 390 1 0 0 0 1 0 0 0 1 69819.dat
1 0 -140 -19.7646 370 0 1 0 -1 0 0 0 0 1 61332.dat
1 0 -120 -19.7646 370 0 1 0 -1 0 0 0 0 1 61332.dat
1 0 120 -9.7646 190 0 1 0 0 0 -1 -1 0 0 24121.dat
1 0 140 -9.7646 190 0 -1 0 1 0 0 0 0 1 24121.dat
1 71 130 -182.9697 290 1 0 0 0 1 0 0 0 1 3673.dat
1 71 130 -109.7646 363.2051 1 0 0 0 1 0 0 0 1 3673.dat
1 4 130 -9.7646 390 1 0 0 0 1 0 0 0 1 32062.dat
1 4 130 -9.7646 390 1 0 0 0 1 0 0 0 1 69819.dat
1 0 120 -19.7646 370 0 1 0 -1 0 0 0 0 1 61332.dat
1 0 140 -19.7646 370 0 1 0 -1 0 0 0 0 1 61332.dat
1 26 0 -9.7646 370 0 0 1 0 1 0 -1 0 0 32525.dat
1 0 0 -29.7646 370 0 0 1 0 1 0 -1 0 0 32278.dat
1 19 -80 -29.7646 370 0 1 0 1 0 0 0 0 -1 39888.dat
1 19 80 -29.7646 370 0 1 0 1 0 0 0 0 -1 39888.dat
1 322 0 -49.7646 370 0 0 -1 0 1 0 1 0 0 11954.dat
` },
    { id: 'back-lift', port: 'C', label: 'Back lift arm', note: 'motor C: a beam behind the robot that lifts and lowers (a 20-tooth gear meshing with the 28-tooth gear)',
      ldr: `1 4 -40 -169.76 191 -1 0 0 0 0 1 0 1 0 3708.dat
1 19 -20 -169.76 191 0 0 1 0 -1 0 1 0 0 18575.dat
1 0 -160 -169.76 271 0 -1 0 -1 0 0 0 0 -1 40490.dat
1 322 -140 -169.76 191 0 1 0 -1 0 0 0 0 1 60483.dat
1 71 -150 -169.76 211 -1 0 0 0 -1 0 0 0 1 3673.dat
` },
  ],
};

/** The tools on a new robot: LEGO's Lift Arm on the front frame (motor D) and Dozer Blade on the back (motor C), as in
 * LEGO's Mission Ready lesson. `stops`: how far each tool motor turns before its parts meet the robot (degrees, measured
 * by the robot builder's toolStops; it measures them again whenever the robot is opened there). */
export function defaultTools() {
  const pick = (id) => TOOL_PRESETS.advanced.find((t) => t.id === id).ldr;
  return { module: 'custom', mount: 'front', ldr: '0 LEGO Lift Arm and Dozer Blade\n' + pick('lift-arm') + pick('dozer'), stops: { D: [-264, 32], C: [-328, 58] } };
}
