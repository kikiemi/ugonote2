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

export type { LoadedProject } from '../../fmt'
export type { FlipLoaded } from './project'

export type CmdMap = anim.Cmds & pen.Cmds & view.Cmds & frame.Cmds & play.Cmds & sel.Cmds & snd.Cmds & marks.Cmds & project.Cmds
export type CmdName = keyof CmdMap

const COMMANDS = {
  ...anim.ANIM_COMMANDS,
  ...pen.PEN_COMMANDS,
  ...view.VIEW_COMMANDS,
  ...frame.FRAME_COMMANDS,
  ...play.PLAY_COMMANDS,
  ...sel.SELECTION_COMMANDS,
  ...snd.SOUND_COMMANDS,
  ...marks.MARK_COMMANDS,
  ...project.PROJECT_COMMANDS,
}

const COMMAND_EFFECTS: Partial<Record<CmdName, number>> = {
  ...anim.ANIM_EFFECTS,
  ...pen.PEN_EFFECTS,
  ...view.VIEW_EFFECTS,
  ...frame.FRAME_EFFECTS,
  ...play.PLAY_EFFECTS,
  ...sel.SELECTION_EFFECTS,
  ...snd.SOUND_EFFECTS,
  ...marks.MARK_EFFECTS,
  ...project.PROJECT_EFFECTS,
}

const TOUCH_COMMANDS = new Set<CmdName>([...anim.ANIM_TOUCH, ...pen.PEN_TOUCH, ...view.VIEW_TOUCH, ...frame.FRAME_TOUCH, ...play.PLAY_TOUCH, ...sel.SELECTION_TOUCH, ...snd.SOUND_TOUCH, ...marks.MARK_TOUCH, ...project.PROJECT_TOUCH])

export const dispatch = make_dispatch<CmdMap>(COMMANDS, COMMAND_EFFECTS, TOUCH_COMMANDS)
