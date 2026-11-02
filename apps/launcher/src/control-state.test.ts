import { describe, it, expect } from "vitest";
import { parseControlState } from "./control-state";
const valid = {schemaVersion:1,profile:null,account:{signedIn:false},credentials:[],customProviders:[],providers:[],models:[]};
describe("configuration response boundary", () => {
 it("validates explicit model readiness", () => {
  expect(parseControlState({...valid,modelReady:false}).modelReady).toBe(false);
  expect(parseControlState({...valid,modelReady:true}).modelReady).toBe(true);
  expect(()=>parseControlState({...valid,modelReady:"yes"})).toThrow();
 });
 it("accepts a sign-out advisory and rejects unknown revocation values", () => {
   expect(parseControlState({...valid,account:{signedIn:false,revocation:"unconfirmed"}}).account.revocation).toBe("unconfirmed");
   expect(()=>parseControlState({...valid,account:{signedIn:false,revocation:"maybe"}})).toThrow();
 });
 it("accepts complete empty state", () => expect(parseControlState(valid).customProviders).toEqual([]));
 it("carries provider auth capabilities without rejecting older rows", () => {
   const state = {...valid,providers:[{id:"openai-codex",name:"OpenAI Codex",oauth:true,oauthName:"OpenAI (ChatGPT Plus/Pro)",apiKey:false}]};
   expect(parseControlState(state).providers[0].oauth).toBe(true);
   expect(parseControlState({...valid,providers:[{id:"openai",name:"OpenAI"}]}).providers[0].oauth).toBeUndefined();
   expect(()=>parseControlState({...state,providers:[{id:"x",name:"X",oauth:"yes"}]})).toThrow();
 });
 it("rejects the old response that crashed connection rendering", () => {
   const {customProviders, ...old} = valid;
   expect(() => parseControlState(old)).toThrow("incompatible");
 });
 it("rejects missing arrays, malformed rows and invalid versions", () => {
   for (const key of ["credentials","providers","models","customProviders"]) {
     expect(() => parseControlState({...valid,[key]:undefined})).toThrow();
     expect(() => parseControlState({...valid,[key]:[null]})).toThrow();
   }
   expect(() => parseControlState({...valid,schemaVersion:2})).toThrow();
   expect(() => parseControlState({...valid,providers:[{id:"",name:"bad"}]})).toThrow();
 });
});
