import { make_dispatch } from '../command'
import * as anim from './anim'
import * as frame from './frame'
import * as marks from './marks'
import * as pen from './pen'
import * as play from './play'
import * as project from './project'
import * as sel from './sel'
import * as snd from './snd'
import * as view from './view'

export type { loaded_project_t } from '../../fmt'
export type { flip_loaded_t } from './project'

export type cmd_map_t = anim.cmds_t & pen.cmds_t & view.cmds_t & frame.cmds_t & play.cmds_t & sel.cmds_t & snd.cmds_t & marks.cmds_t & project.cmds_t
export type cmd_name_t = keyof cmd_map_t

const commands = {
  ...anim.anim_commands,
  ...pen.pen_commands,
  ...view.view_commands,
  ...frame.frame_commands,
  ...play.play_commands,
  ...sel.selection_commands,
  ...snd.sound_commands,
  ...marks.mark_commands,
  ...project.project_commands,
}

const command_effects: Partial<Record<cmd_name_t, number>> = {
  ...anim.anim_effects,
  ...pen.pen_effects,
  ...view.view_effects,
  ...frame.frame_effects,
  ...play.play_effects,
  ...sel.selection_effects,
  ...snd.sound_effects,
  ...marks.mark_effects,
  ...project.project_effects,
}

const touch_commands = new Set<cmd_name_t>([...anim.anim_touch, ...pen.pen_touch, ...view.view_touch, ...frame.frame_touch, ...play.play_touch, ...sel.selection_touch, ...snd.sound_touch, ...marks.mark_touch, ...project.project_touch])

export const dispatch = make_dispatch<cmd_map_t>(commands, command_effects, touch_commands)
