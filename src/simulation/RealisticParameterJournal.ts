import type {Typhoon} from '../types';
/** Retain only snapshots included in the branched timeline, even after rewinds. */
export function trimRealisticParameterJournal(ty:Typhoon,history:Typhoon['history']):Typhoon['realisticMotion']{
 const journal=ty.realisticMotion;
 if(!journal||history.length<7)return undefined;
 const original=journal.original.filter(h=>h.simHour<=(history.at(-1)?.simHour??-Infinity)+1e-5);
 if(!original.length||original.length>history.length)return undefined;
 for(let i=0;i<original.length;i++)if(Math.abs(original[i].simHour-history[i].simHour)>1e-5)return undefined;
 return {...journal,original} as Typhoon['realisticMotion'];
}
