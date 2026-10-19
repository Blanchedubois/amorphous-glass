// Live Liquid Glass behind one piece of the Control Center, through Blur My Shell's own dynamic
// surface (the one its popup module uses), on the glass menus pipeline, so the pieces share the
// recipe of the bar, the menus and the dock, modes included. Without Blur My Shell the piece
// falls back to a translucent fill from the stylesheet.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

const BMS_UUID = 'blur-my-shell@aunetx';
const PIPELINE = 'pipeline_glassbar_menus';

let _lib = null;

export async function loadBms() {
    const ext = Main.extensionManager.lookup(BMS_UUID);
    if (ext?.state !== ExtensionState.ACTIVE || !global.blur_my_shell)
        return null;
    if (!_lib) {
        const {DynamicPipeline} = await import(`file://${ext.path}/render/dynamic_surface.js`);
        _lib = {DynamicPipeline};
    }
    return {..._lib, bms: global.blur_my_shell};
}

// pieces: [{actor, radius}]; returns what destroys the glass again
export function attachGlass(lib, pieces) {
    const pipelines = [];
    for (const {actor, radius} of pieces) {
        const pipeline = new lib.DynamicPipeline(
            lib.bms._effects_manager, lib.bms._pipelines_manager, PIPELINE,
            {corner_radius: radius, get_corners: () => 0});
        pipeline.attach_to_container(actor, 'tahoe-cc-glass');
        actor.add_style_class_name('glassed');
        pipelines.push(pipeline);
    }
    // the glass actor is a child of the piece and takes its pipeline down with it
    return () => {
        pipelines.forEach(p => p.actor?.destroy());
        pieces.forEach(({actor}) => actor.remove_style_class_name('glassed'));
    };
}
