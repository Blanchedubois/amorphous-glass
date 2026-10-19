// Top panel layout for the CachyOS Tahoe theme. Applied by install.sh through
// plasmashell's scripting interface. Idempotent: safe to re-run.
//
// Steps P1 to P7 from docs/IMPLEMENTATION.md section 4.1.
for (var p of panels()) {
  if (p.location != "top") continue;

  // P1: MacTahoe's own bar: 32 px, flush to the top edge, adaptive opacity.
  p.height = 32;
  p.floating = false;
  p.lengthMode = "fill";
  p.opacity = "adaptive";

  var toRemove = [];
  var separators = 0;
  for (var id of p.widgetIds) {
    var w = p.widgetById(id);

    // P2: CachyOS mark as the launcher glyph (symbolic, from the icon theme).
    if (w.type == "org.kde.plasma.kickoff") {
      w.currentConfigGroup = ["General"];
      w.writeConfig("icon", "cachyos-launcher");
      w.reloadConfig();
      // Smaller launcher card.
      w.currentConfigGroup = [];
      w.writeConfig("popupWidth", 540);
      w.writeConfig("popupHeight", 440);
    }

    // P6: 24 hour clock, no date, semibold 13.
    if (w.type == "org.kde.plasma.digitalclock") {
      w.currentConfigGroup = ["Appearance"];
      w.writeConfig("showDate", false);
      w.writeConfig("use24hFormat", 2);
      w.writeConfig("autoFontAndSize", false);
      w.writeConfig("fontFamily", "Noto Sans");
      w.writeConfig("fontSize", 13);
      w.writeConfig("fontWeight", 600);
      w.reloadConfig();
      // Calendar card: narrower than Plasma's default.
      w.currentConfigGroup = [];
      w.writeConfig("popupWidth", 300);
      w.writeConfig("popupHeight", 330);
      // Compact month grid: no events pane, no week numbers.
      w.currentConfigGroup = ["Appearance"];
      w.writeConfig("enabledCalendarPlugins", "");
      w.writeConfig("showWeekNumbers", false);
      w.reloadConfig();
    }

    // P5: large spacing between tray icons so the hover highlight of one
    // item does not bleed into its neighbours.
    if (w.type == "org.kde.plasma.systemtray") {
      w.currentConfigGroup = ["General"];
      w.writeConfig("iconSpacing", 1);
      w.reloadConfig();
    }

    // P4: one margins separator is enough between the tray and the clock.
    if (w.type == "org.kde.plasma.marginsseparator") {
      separators++;
      if (separators > 1) toRemove.push(w);
    }

    // P7: show desktop leaves; Overview takes the top-left hot corner instead.
    if (w.type == "org.kde.plasma.showdesktop") toRemove.push(w);
  }
  for (var w of toRemove) w.remove();
}
