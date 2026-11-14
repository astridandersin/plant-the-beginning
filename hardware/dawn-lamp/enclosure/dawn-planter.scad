// Dawn planter lamp: a bedside lamp that is also a plant pot.
// Printed parts, stacked:
//   0. bottom   removable floor plate: 4 screws (M3 x 10, self-tapping) into
//               posts in the base, air slots under the board, and the two
//               slotted posts that hold the UNO Q upright. Wire everything on
//               the bench, then slide plate + board up into the base.
//   1. base     electronics shell, printed UPSIDE DOWN (flat top on the bed):
//               matrix window in the flat front, Modulino Knob front-right and
//               Buzzer front-left on screw posts, an outside vented pocket for
//               the Modulino Thermo (so it reads the room, not the board),
//               USB-C power slot with a zip-tie point, vents. Closed top plate.
//   2. sleeve   a thin wavy cachepot (ocean waves, even wall) that stands on
//               the base and catches the pot's drainage water in its floor.
//               A notch at the back of its rim lets the soil-sensor lead out; the
//               lead runs down the outside into a hole in the base's back wall.
//   3. pot      NOT PRINTED by default: use the plastic nursery pot the plant
//               comes in (up to 10.5 cm across the rim, about 9 cm tall). It stands
//               on four feet in the sleeve's floor, clear of the drained water.
//               The printed pot module is kept below in case it's wanted.
//   4. window   a thin plate that presses into the front window. Print it white
//               or translucent: the LED matrix glows through it as Dawn's light.
// (Fast version, 14 Nov: the double-walled sleeve, light ring and pins were cut
// to save print hours.)
//
// WATER SAFETY: water drains from the pot into the sleeve's floor, which sits on
// the base's closed top plate. Printed plastic can seep along layer lines, so
// print the sleeve with 4 perimeters and 6 bottom layers (PETG if the lab has it)
// and test it with water BEFORE the electronics go in. Water little and often:
// the floor holds about well_volume_ml() below the pot's feet.
//
// Export: set `part` below, render (F6), File > Export > STL. One STL per part;
// each part is already oriented for printing.
// Slice: base and bottom can use 0.28 mm layers and 3 perimeters (fast); sleeve
// and pot 0.2 mm, sleeve as above, pot 2 perimeters. 10 % infill. No supports
// needed: the base prints upside down so its big top plate lies on the bed,
// the other roofs are short bridges or 45-degree chamfers, and the pot's taper
// is gentle. Check the slicer preview.
// Assembly without measuring: the Knob and Buzzer go on with double-sided foam tape
// plus a ring of hot glue round each board; the UNO Q's slots are loose, so wedge
// them with a strip of tape. Wiring: give the soil sensor a plug near the pot rim and some spare cable, so
// the pot lifts out for watering without pulling on the board. Stick four
// rubber or felt feet under the bottom plate. Measure your board and knob before printing (values marked verify).

/* [What to export] */
part = "all"; // [all, bottom, base, sleeve, pot, window]

/* [Overall] */
outer_d  = 150;   // outside diameter of base and sleeve (mm)
wall     = 2.4;   // wall thickness
flat_cut = 7;     // the front is flattened by this much so the Knob sits flat
$fn      = 96;

/* [Printed pot] */
pot_top_d   = 105;  // outside diameter at the rim
pot_bottom_d = 84;  // outside diameter at the floor (taper makes it lift out easily)
pot_h       = 88;   // height without feet
pot_wall    = 1.6;
pot_floor   = 2.4;
pot_feet_h  = 6;    // the pot stands this high above the well floor
drain_d     = 6;    // drainage holes in the pot floor
pot_gap     = 2;    // clearance between pot rim and sleeve

/* [Base: electronics] */
base_h     = 66;    // floor to the top of the closed plate (tall enough for the upright board)
floor_t    = 2.4;
top_t      = 2.4;   // closed plate between electronics and plant
fit        = 0.35;  // clearance for press fits; raise if they are tight
screw_angles = [-5, 60, 120, 185]; // bottom-plate screw posts, clear of the window, knob and buzzer
// UNO Q sizes from Arduino's datasheet ABX00162/ABX00173, section 12 (Mechanical Information):
// 68.58 x 53.34 mm, top-side parts up to about 8.5 mm (headers), bottom-side parts under 2 mm.
// The board stands on its long edge, components and LED matrix facing the window, with the
// matrix's edge DOWN (the matrix sits about 5-21 mm from that edge, 31-59 mm from the USB-C end)
// and the USB-C end on the left as seen from the front.
board_w    = 68.58;
board_d    = 53.34; // stands upright, so this is its height
board_t    = 1.6;   // PCB thickness is not in the datasheet; 1.6 mm is standard
board_gap  = 10;    // from the inside of the front wall to the board's face (room for headers)
slot_w     = 2.8;   // rail slot for the board edge: loose on purpose (thickness unmeasured); wedge with tape
window_w   = 36;    // front window over the LED matrix (8 x 13 LEDs, about 27 x 16 mm on the board)
window_h   = 22;
window_x   = 10;    // the matrix is right of the board's centre (seen from the front)
window_z   = 6;     // bottom of the window above the base's bottom
knob_hole  = 9.5;   // generous: clears a 6 mm shaft or a threaded collar up to about 9 mm; the Knob is hot-glued or foam-taped behind it
// was 7.5;   // Modulino Knob (ABX00107): Bourns PEC11J encoder, 6 mm shaft in this family (check the nut/bushing)
knob_angle = -35;   // front-right, on the curved wall (front is -90)
knob_z     = 34;    // shaft height above the base's bottom
knob_standoff = 7;  // board-to-wall distance so the encoder body fits (hold it up and check)
buzzer_standoff = 4;
modulino_holes = [[-16, -8], [-16, 8], [16, -8], [16, 8]]; // 32 x 16 mm hole pattern (datasheet), board long side horizontal
buzzer_angle = -145; // front-left
thermo_angle = 45;  // back-right, outside pocket
thermo_w = 26; thermo_h = 42; thermo_t = 7;   // Modulino Thermo: 41 x 25.36 x 1.6 mm (datasheet ABX00103, 6.1); Qwiic on the short edges
usb_w = 14; usb_h = 9; usb_z = 10; // power cable slot in the back wall

/* [Sleeve: thin wavy cachepot] */
sleeve_wall  = 1.8;   // 4 perimeters of a 0.45 mm line
sleeve_floor = 2.4;
// Ocean waves on the sleeve: horizontal swells that roll round the pot and rise and
// fall like a sea surface. The whole wall follows them, so its thickness stays even.
wave_a     = 2.6;     // how far a crest stands out (mm)
wave_band  = 17;      // height of one swell, crest to crest (mm)
wave_roll  = 5;       // how many times each swell rises and falls going round
wave_swing = 6;       // how far each crest rises and falls (mm)
wave_res_a = 240;     // mesh detail round
wave_res_z = 110;     // mesh detail up
cable_d  = 10;        // soil-sensor lead into the base's back wall (fits a 3-pin JST plug)

pot_cavity_d = pot_top_d + 2 * pot_gap;
sleeve_r     = pot_cavity_d / 2 + sleeve_wall;      // outside radius between wave crests
sleeve_h     = sleeve_floor + pot_feet_h + pot_h + 2;  // pot rim sits 2 mm below the top
cable_angle  = 135;                              // back-left, away from the knob (front is -Y)

// Water the well holds below the pot's feet (ml), for the print notes.
function well_volume_ml() = 3.14159 * pow(pot_cavity_d / 2, 2) * pot_feet_h / 1000;
echo(str("Well holds about ", round(well_volume_ml()), " ml below the pot's feet; sleeve height ", sleeve_h, " mm"));


module ring(d_out, d_in, h) {
  difference() { cylinder(d = d_out, h = h); translate([0, 0, -0.1]) cylinder(d = d_in, h = h + 0.2); }
}

// A disc of diameter d, flattened at the front by `cut` from the outer circle.
module flat_disc(d, cut, h) {
  intersection() {
    cylinder(d = d, h = h);
    translate([-outer_d, -outer_d / 2 + cut, 0]) cube([2 * outer_d, 2 * outer_d, h]);
  }
}

// Radius of the sleeve's outside at angle a and height z. Each swell has a gentle back
// and a fuller crest (the power of 1.6), and the crest line itself rolls up and down;
// neighbouring swells are shifted so the pattern reads as a moving sea, not stripes.
function sea_r(a, z, r0) =
  let(drift = z / wave_band,  // a smooth phase drift up the sleeve, so swells don't line up
      crest = z + wave_swing * sin(wave_roll * a + 40 * drift) + 0.35 * wave_swing * sin(2 * wave_roll * a - 25 * drift),
      u = (1 + sin(360 * crest / wave_band)) / 2)
  r0 + wave_a * pow(u, 1.6) * min(1, z / 6, (sleeve_h - z) / 6);  // fades out at top and bottom edges

module sea_shell(r0, z0 = 0) {
  na = wave_res_a; nz = wave_res_z;
  pts = concat(
    [for (i = [0 : nz]) for (j = [0 : na - 1])
      let(z = z0 + (sleeve_h + 1 - z0) * i / nz, a = 360 * j / na, r = sea_r(a, min(z, sleeve_h), r0)) [r * cos(a), r * sin(a), z]],
    [[0, 0, z0], [0, 0, sleeve_h + 1]]);
  bc = (nz + 1) * na; tc = bc + 1;
  faces = concat(
    [for (i = [0 : nz - 1]) for (j = [0 : na - 1])
      let(j2 = (j + 1) % na) [i * na + j, (i + 1) * na + j, (i + 1) * na + j2, i * na + j2]],
    [for (j = [0 : na - 1]) [bc, j, (j + 1) % na]],
    [for (j = [0 : na - 1]) [tc, nz * na + (j + 1) % na, nz * na + j]]);
  polyhedron(points = pts, faces = faces, convexity = 6);
}


board_y = -outer_d / 2 + flat_cut + wall + board_gap;  // front face of the upright board

// radial hole through the round wall at an angle
module radial_hole(angle, z, d) {
  rotate([0, 0, angle]) translate([outer_d / 2 - wall - 2, 0, z]) rotate([0, 90, 0]) cylinder(d = d, h = wall + 4);
}

// vented pocket on the outside wall; the Thermo slides in from the top, sensor facing out
module thermo_pocket(solid) {
  rotate([0, 0, thermo_angle]) translate([outer_d / 2 - 1.5, 0, 0]) { // full height, so it prints without supports
    if (solid) difference() {
      translate([0, -(thermo_w + 2 * wall) / 2, 0]) cube([thermo_t + wall + 1.5, thermo_w + 2 * wall, base_h]);
      // the board's slot, open at the top; the board rests on the solid bottom 8 mm
      translate([1.5, -thermo_w / 2, 8]) cube([thermo_t, thermo_w, base_h]);
      // air slots in the outer face
      for (z = [14 : 7 : thermo_h + 2]) translate([thermo_t + 1, -thermo_w / 2 + 4, z]) cube([wall + 2, thermo_w - 8, 3]);
    }
    // Qwiic cable hole into the base, at the bottom of the pocket
    else translate([-wall - 3, -5, 8]) cube([wall + 6, 10, 7]);
  }
}

R_in = outer_d / 2 - wall;  // inside radius of the base wall

// screw posts for a Modulino on the curved wall: the board sits `st` in from the wall
module modulino_posts(angle, z, st, holes_only = false) {
  rotate([0, 0, angle]) for (h = modulino_holes) translate([R_in - st, h[0], z + h[1]]) rotate([0, 90, 0])
    if (holes_only) translate([0, 0, -1]) cylinder(d = 2.6, h = 7);
    else cylinder(d = 6, h = st);
}

// vertical screw post for the bottom plate (full height, so no overhang when printed upside down)
module at_screw(a) { rotate([0, 0, a]) translate([R_in - 2.5, 0, 0]) children(); }

module base() {
  difference() {
    union() {
      difference() {
        union() {
          flat_disc(outer_d, flat_cut, base_h);
          thermo_pocket(true);
        }
        // electronics cavity: open at the bottom (the bottom plate closes it) up to the top plate
        translate([0, 0, -1]) flat_disc(outer_d - 2 * wall, flat_cut + wall, base_h - top_t + 1);
      }
      for (a = screw_angles) at_screw(a) cylinder(d = 8, h = base_h - top_t);
      // No screw posts for the Knob and Buzzer: their heights weren't measured, so they are
      // fixed with double-sided foam tape and hot glue instead (the encoder body rests on the wall).
      // zip-tie point beside the USB-C slot, with a 45-degree chamfer on its top end
      rotate([0, 0, 75]) translate([R_in - 5, -5, 0]) hull() {
        cube([5.5, 10, 30]);
        translate([5, 0, 0]) cube([0.5, 10, 35]);
      }
    }
    // screw holes for the bottom plate
    for (a = screw_angles) at_screw(a) translate([0, 0, -1]) cylinder(d = 2.6, h = 13);
    // zip-tie tunnel
    rotate([0, 0, 75]) translate([R_in - 3.5, -6, 18]) cube([2.5, 12, 4]);
    // matrix window through the flat front
    translate([window_x - window_w / 2, -outer_d / 2 + flat_cut - 1, window_z]) cube([window_w, wall + 2, window_h]);
    // knob shaft hole, front-right
    radial_hole(knob_angle, knob_z, knob_hole);
    // buzzer holes, front-left
    for (da = [-4, 0, 4], dz = [-6, 0, 6]) radial_hole(buzzer_angle + da, knob_z + dz, 2.2);
    // Thermo cable hole
    thermo_pocket(false);
    // USB-C power slot, back wall
    translate([-usb_w / 2, outer_d / 2 - wall - 4, usb_z]) cube([usb_w, wall + 8, usb_h]);
    // vents, back wall
    for (i = [-3:3]) translate([i * 9 - 2, outer_d / 2 - wall - 4, base_h - top_t - 22]) cube([4, wall + 8, 14]);
    // soil-sensor lead comes in high on the back-left wall
    radial_hole(cable_angle, base_h - top_t - 9, cable_d);
  }
}

module bottom() {
  difference() {
    union() {
      flat_disc(outer_d, flat_cut, floor_t);
      // lip that centres the plate in the base, notched round the screw posts
      difference() {
        translate([0, 0, floor_t]) difference() {
          flat_disc(outer_d - 2 * wall - 2 * fit, flat_cut + wall + fit, 2);
          translate([0, 0, -1]) flat_disc(outer_d - 2 * wall - 6, flat_cut + wall + 3, 4);
        }
        for (a = screw_angles) at_screw(a) cylinder(d = 9.5, h = 10);
      }
      // two slotted posts hold the board's short edges upright, face to the window. No floor
      // rail: the headers run along the bottom edge on the front face. Posts stop at 30 mm so
      // they clear the USB-C socket near the top of the left edge.
      difference() {
        for (sx = [-1, 1]) translate([sx * (board_w / 2 + 1) - 4, board_y - 3, floor_t]) cube([8, board_t + 6, 30]);
        translate([-board_w / 2 - 0.5, board_y - (slot_w - board_t) / 2, floor_t]) cube([board_w + 1, slot_w, 50]);
      }
    }
    // screw holes
    for (a = screw_angles) at_screw(a) translate([0, 0, -1]) cylinder(d = 3.4, h = floor_t + 4);
    // air slots behind the board, where the warm side is
    for (i = [-4:4]) translate([i * 9 - 1.5, board_y + 12, -1]) cube([3, 40, floor_t + 2]);
  }
}


module window() {
  // flat face on the bed, plug up; it presses into the window from inside
  translate([-(window_w + 6) / 2, -(window_h + 6) / 2, 0]) cube([window_w + 6, window_h + 6, 1]);
  translate([-(window_w - 2 * fit) / 2, -(window_h - 2 * fit) / 2, 0]) cube([window_w - 2 * fit, window_h - 2 * fit, 1 + wall]);
}

module sleeve() {
  difference() {
    intersection() {
      sea_shell(sleeve_r);
      cylinder(r = outer_d, h = sleeve_h);
    }
    // the inside follows the same waves, one wall thickness in, above the floor
    sea_shell(sleeve_r - sleeve_wall, sleeve_floor);
    // notch at the back of the rim for the soil-sensor lead
    rotate([0, 0, cable_angle]) translate([sleeve_r - 4, -5, sleeve_h - 10]) cube([10, 10, 11]);
  }
  // four feet on the floor, so the nursery pot stands clear of the drained water
  for (a = [45:90:315]) rotate([0, 0, a]) translate([28, 0, sleeve_floor - 0.1]) cylinder(d = 8, h = pot_feet_h);
}

module pot() {
  difference() {
    union() {
      translate([0, 0, pot_feet_h]) cylinder(d1 = pot_bottom_d, d2 = pot_top_d, h = pot_h);
      // four feet, so the pot stands clear of the water in the well
      for (a = [45:90:315]) rotate([0, 0, a]) translate([pot_bottom_d / 2 - 9, 0, 0]) cylinder(d = 10, h = pot_feet_h + 1);
    }
    // inside of the pot (same taper, walls pot_wall thick)
    translate([0, 0, pot_feet_h + pot_floor])
      cylinder(d1 = pot_bottom_d - 2 * pot_wall, d2 = pot_top_d - 2 * pot_wall, h = pot_h);
    // drainage: one centre hole and a ring of five
    translate([0, 0, -1]) cylinder(d = drain_d, h = pot_feet_h + pot_floor + 2);
    for (a = [0:72:288]) rotate([0, 0, a + 18]) translate([pot_bottom_d / 4, 0, -1]) cylinder(d = drain_d, h = pot_feet_h + pot_floor + 2);
    // rim notch for the soil sensor lead
    rotate([0, 0, cable_angle]) translate([pot_top_d / 2 - 6, -4, pot_feet_h + pot_h - 10]) cube([10, 8, 11]);
  }
}


if (part == "base") translate([0, 0, base_h]) rotate([180, 0, 0]) base(); // upside down: flat top on the bed
else if (part == "bottom") bottom();
else if (part == "sleeve") sleeve();
else if (part == "pot") pot();
else if (part == "window") window();
else if (part == "all") {  // exploded view
  color("DimGray") translate([0, 0, -floor_t - 35]) bottom();
  color("Gainsboro") base();
  color([1, 0.97, 0.85], 0.9) translate([window_x, -outer_d / 2 + flat_cut - 1 - 40, window_z + window_h / 2]) rotate([-90, 0, 0]) window();
  color("WhiteSmoke") translate([0, 0, base_h + 35]) sleeve();
}

