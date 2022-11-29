import * as TelegramBot from "node-telegram-bot-api";
import {Wallet} from "@ethersproject/wallet";
import {ipfsPublish, ipfsPublishBuffer} from "../../ipfs-publish";
import { setAllowance, getAllowance, getActiveEvidenceGroupId } from "../../db";
import fetch from 'node-fetch';
import { getQuestionsNotFinalized } from "../../graph";
import { groupSettings } from "../../../types";
import langJson from "../assets/lang.json";
const _contract = require('../../abi/Realitio_v2_1_ArbitratorWithAppeals.json')
const Web3 = require('web3')
const web3 = new Web3(process.env.WEB3_PROVIDER_URL)
const contract = new web3.eth.Contract(
    _contract,
    process.env.REALITIO_ARBITRATOR
  )

var botAddress: string;

const processCommand = async (bot: TelegramBot, settings: groupSettings, msg: TelegramBot.Message, questionId: number|string, batchedSend: any ): Promise<string> => {
    const evidencePath = await upload(bot, settings.lang, msg);
    const evidenceJsonPath = await uploadEvidenceJson(settings.lang, msg, evidencePath);
    submitEvidence(batchedSend, evidenceJsonPath, questionId);
    bot.sendMessage(settings.channelID, `${langJson[settings.lang].addevidence.submitted}(https://ipfs.kleros.io${evidencePath}).`, {parse_mode: "Markdown"});

    return evidenceJsonPath;
}

const upload = async (bot: TelegramBot, lang: string, msg: TelegramBot.Message): Promise<string> => {
    if (msg.reply_to_message.text){
        return await uploadTextEvidence(lang, msg);
    } else if (msg.reply_to_message.location){
        return await uploadLocationEvidence(lang, msg);
    } else if (msg.reply_to_message.poll){
        return await uploadPollEvidence(lang, msg);
    } else {
        var file: TelegramBot.File;
        if (msg.reply_to_message.sticker){
            file = await bot.getFile(msg.reply_to_message.sticker.file_id);
        } else if (msg.reply_to_message.photo){
            file = await bot.getFile(msg.reply_to_message.photo[msg.reply_to_message.photo.length-1].file_id);   
        } else if (msg.reply_to_message.audio){
            file = await bot.getFile(msg.reply_to_message.audio.file_id);   
        } else if (msg.reply_to_message.voice){
            file = await bot.getFile(msg.reply_to_message.voice.file_id);   
        } else if (msg.reply_to_message.video){
            file = await bot.getFile(msg.reply_to_message.video.file_id);   
        } else if (msg.reply_to_message.video_note){
            file = await bot.getFile(msg.reply_to_message.video_note.file_id);   
        } else if (msg.reply_to_message.document){
            file = await bot.getFile(msg.reply_to_message.document.file_id);   
        }
        const filePath = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/`+file.file_path;
        const fileIPFS = await uploadFileEvidence(filePath, file.file_path.replace('/','_'));
        return fileIPFS;
    }

}

const uploadFileEvidence = async (filePath: string, fileName: string): Promise<string> => {
    const enc = new TextEncoder();
    const file = await fetch(filePath)
        .then(res => res.buffer())
        .then(async buffer => { return await ipfsPublishBuffer(fileName,buffer); });
    return file;
}

const uploadLocationEvidence = async (lang: string, msg: TelegramBot.Message): Promise<string> => {
    const enc = new TextEncoder();
    const author = (msg.reply_to_message.from.username || msg.reply_to_message.from.first_name) + ' ID:'+msg.reply_to_message.from.id ;
    const fileName = `${langJson[lang]["addevidence"].location}.txt`;
    const chatHistory = `${langJson[lang].addevidence.Chat}: ${msg.chat.title} (${String(msg.chat.id)})
    
${langJson[lang].addevidence.Author}: ${author} (${(new Date(msg.reply_to_message.date*1000)).toISOString()})

${langJson[lang].addevidence.Message} (${langJson[lang].addevidence.location}): ${langJson[lang].addevidence.latitude} - ${msg.reply_to_message.location.latitude}, ${langJson[lang].addevidence.longitude} - ${msg.reply_to_message.location.longitude}`;

    const evidencePath = await ipfsPublish(`${fileName}`, enc.encode(chatHistory));

    return evidencePath;
}

const uploadPollEvidence = async (lang: string, msg: TelegramBot.Message): Promise<string> => {
    const enc = new TextEncoder();
    const author = (msg.reply_to_message.from.username || msg.reply_to_message.from.first_name) + ' ID:'+msg.reply_to_message.from.id ;
    const fileName = `${langJson[lang].addevidence.Poll}.txt`;
    var chatHistory = `${langJson[lang].addevidence.Chat}: ${msg.chat.title} (${String(msg.chat.id)})
    
${langJson[lang].addevidence.Author}: ${author} (${(new Date(msg.reply_to_message.date*1000)).toISOString()})

${langJson[lang].addevidence.Message} (${langJson[lang].addevidence.Poll}): \n  ${langJson[lang].addevidence.Question} - ${msg.reply_to_message.poll.question} \n`;

    msg.reply_to_message.poll.options.forEach(option => {
        chatHistory += ` ${langJson[lang].addevidence.Option}:'+option.text+'\n`;
    });

    const evidencePath = await ipfsPublish(`${fileName}`, enc.encode(chatHistory));

    return evidencePath;
}

const uploadTextEvidence = async (lang: string, msg: TelegramBot.Message): Promise<string> => {
    const enc = new TextEncoder();
    const author = (msg.reply_to_message.from.username || msg.reply_to_message.from.first_name) + ' ID:'+msg.reply_to_message.from.id ;
    const fileName = `${langJson[lang].addevidence.Message}.txt`;
    const chatHistory = `${langJson[lang].addevidence.Chat}: ${msg.chat.title} (${String(msg.chat.id)})
    
${langJson[lang].addevidence.Author}: ${author} (${(new Date(msg.reply_to_message.date*1000)).toISOString()})

${langJson[lang].addevidence.Message}: ${msg.reply_to_message.text}`;

    const evidencePath = await ipfsPublish(`${fileName}`, enc.encode(chatHistory));

    return evidencePath;
}

const uploadEvidenceJson = async (lang: string, msg: TelegramBot.Message, evidenceItem: string): Promise<string> => {
    const _name = `Kleros Moderator Bot: ${langJson[lang].addevidence.Chat} ${langJson[lang].addevidence.History}`;
    const author = (msg.reply_to_message.from.username || msg.reply_to_message.from.first_name) + ' ID:'+msg.reply_to_message.from.id ;
    const enc = new TextEncoder();
    if (!botAddress)
        botAddress = await (await new Wallet(process.env.PRIVATE_KEY)).address
    const _description = `${langJson[lang].addevidence.Desc1} ${botAddress}. 
    
    ${langJson[lang].addevidence.Desc2},
    
    ${msg.chat.title} (${langJson[lang].addevidence.Chat} Id: ${msg.chat.id}),
    
    ${langJson[lang].addevidence.Author},
    
    ${author},
    
    ${langJson[lang].addevidence.Date},
    
    (${(new Date(msg.reply_to_message.date*1000)).toISOString()}).`;

    const evidence = {
        name: _name,
        description: _description,
        fileURI: evidenceItem
      };

      const evidenceJsonPath = await ipfsPublish(`${langJson[lang].addevidence.Evidence}.json`, enc.encode(JSON.stringify(evidence)));

    return evidenceJsonPath;
}

const submitEvidence = async (batchedSend: any, evidencePath: string, questionId: number|string) => {

    batchedSend({
        args: [        
            questionId,
            evidencePath],
        method: contract.methods.submitEvidence,
        to: contract.options.address
      });
}

/*
 * /addevidence [questionId]
 */
const regexp = /\/addevidence/
const regexpFull = /\/addevidence (.+)/

const callback = async (db: any, settings: groupSettings, bot: any, botID: number, msg: any, matchh: string[], batchedSend: any) => {
    if (!msg.reply_to_message) {
        bot.sendMessage(msg.chat.id, `/addevidence ${langJson[settings.lang].errorReply}`, msg.chat.is_forum? {message_thread_id: msg.message_thread_id}:{})
        return;
    }
    if (!botAddress)
        botAddress = await (await new Wallet(process.env.PRIVATE_KEY)).address.toLowerCase();
    const match = msg.text.match(regexpFull);

    //TODO Evidence IDs and button callback UX
    if (!match || match.length < 2){
        const questions = await getQuestionsNotFinalized(botAddress)
        bot.sendMessage(msg.chat.id, `Did you mean `+ JSON.stringify(questions));
        bot.sendMessage(msg.chat.id, `/addevidence ${langJson[settings.lang].addevidence.error1} ${langJson[settings.lang].addevidence.id}`, msg.chat.is_forum? {message_thread_id: msg.message_thread_id}:{})
        //const errorMsg = await errorMessage(db, lang, bot, msg);
        //await bot.sendMessage(msg.chat.id, errorMsg, {parse_mode: "Markdown", disable_web_page_preview: true});
        return; 
    }
    const result = getActiveEvidenceGroupId(db, 'telegram', String(msg.chat.id), Number(match[1]));
    if (!result){
        bot.sendMessage(msg.chat.id, langJson[settings.lang].errorId, msg.chat.is_forum? {message_thread_id: msg.message_thread_id}: {})
        //const errorMsg = await errorMessage(db, lang, bot, msg);
        //await bot.sendMessage(msg.chat.id, errorMsg, {parse_mode: "Markdown", disable_web_page_preview: true});
        return;
    }
    
    const reportAllowance = getAllowance(db, 'telegram', String(msg.chat.id), String(msg.from.id));
    if (!reportAllowance){
        setAllowance(db, 'telegram', String(msg.chat.id), String(msg.from.id), 3, 14, Math.ceil( new Date().getTime() / 1000));
    } else if ((Math.ceil( new Date().getTime() / 1000) < reportAllowance.timestamp_refresh + 5760) && reportAllowance.evidence_allowance == 0 ){
        await bot.sendMessage(msg.chat.id, langJson[settings.lang].errorAllowance);
    } else{
        const newReportAllowance = reportAllowance.report_allowance + Math.floor((Math.ceil( new Date().getTime() / 1000) - reportAllowance.timestamp_refresh)/28800);
        const newEvidenceAllowance = reportAllowance.evidence_allowance + Math.floor((Math.ceil( new Date().getTime() / 1000) - reportAllowance.timestamp_refresh)/28800)*5 - 1;
        const newRefreshTimestamp = reportAllowance.timestamp_refresh + Math.floor((Math.ceil( new Date().getTime() / 1000) - reportAllowance.timestamp_refresh)/28800)*28800;
        setAllowance(db, 'telegram', String(msg.chat.id), String(msg.from.id), Math.min(newReportAllowance,3), Math.min(newEvidenceAllowance,15), newRefreshTimestamp);
    }

    try {
        const evidencePath = await processCommand(bot, settings, msg, match[1],batchedSend);
    } catch (e) {
        console.log(e);

        await bot.sendMessage(msg.chat.id, `${langJson[settings.lang].errorTxn}: ${e.message}.`);
    }
}
/*
const errorMessage = async (db: any, lang: string, bot: TelegramBot, msg: TelegramBot.Message): Promise<string> => {
    const reports = await getDisputedReportsInfo(db, 'telegram', String(msg.chat.id));

    var reportMessage: string = `${langJson[lang].addevidence.msg1}:\n\n`;

    await reports.forEach(async (report) => {
        const MsgLink = 'https://t.me/c/' + report.group_id.substring(4) + '/' + report.msg_id;
        const msgTime = new Date(report.timestamp*1000).toISOString();
        reportMessage += ` - ${report.username} ${langJson[lang].addevidence.msg2} [${msgTime.substring(0,msgTime.length-4)}](${MsgLink}) ([${langJson[lang].socialConsensus.consensus5}](${report.msgBackup})): ${langJson[lang].addevidence.id} ${report.evidenceIndex}\n`;
    });

    return reportMessage;
}
*/
export {regexp, callback, processCommand, submitEvidence, upload};