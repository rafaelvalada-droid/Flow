/* Gmail Workspace add-on. Reads current-message metadata only; never sends mail. */
var FLOW_ORIGIN = 'https://flow-blue-theta.vercel.app';
function flowCard(title) { return CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle(title)); }
function flowAction(name, parameters) { var action=CardService.newAction().setFunctionName(name);if(parameters)action.setParameters(parameters);return action; }
function flowHome() {
 var section=CardService.newCardSection().addWidget(CardService.newTextParagraph().setText('No Ulbraflow, abra Entrada → Conectar celular. Cole aqui a chave de conexão. Depois abra um e-mail para classificar a demanda.'));
 section.addWidget(CardService.newTextInput().setFieldName('flowToken').setTitle('Chave de conexão'));
 section.addWidget(CardService.newTextButton().setText('Conectar').setOnClickAction(flowAction('flowConnect')));
 section.addWidget(CardService.newTextButton().setText('Desconectar').setOnClickAction(flowAction('flowDisconnect')));
 return flowCard('Ulbraflow · Gmail no celular').addSection(section).build();
}
function flowInput(event,name) {
 var input=event.commonEventObject && event.commonEventObject.formInputs && event.commonEventObject.formInputs[name];
 return input && input.stringInputs ? input.stringInputs.value[0] : '';
}
function flowDigest(token) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,token,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join(''); }
function flowRpc(action,payload,token) {
 token=token||PropertiesService.getUserProperties().getProperty('flowToken');
 if(!token)throw new Error('Conecte sua conta na página inicial do complemento.');
 var configuration=UrlFetchApp.fetch(FLOW_ORIGIN+'/api/auth-config',{muteHttpExceptions:true});
 if(configuration.getResponseCode()!==200)throw new Error('Ulbraflow indisponível. Tente novamente.');
 var config=JSON.parse(configuration.getContentText());
 if(!config.configured || config.url!=='https://iwnbrcsmzwjziyluwrrb.supabase.co')throw new Error('Configuração do Ulbraflow indisponível.');
 var response=UrlFetchApp.fetch(config.url+'/rest/v1/rpc/flow_gmail_capture',{method:'post',contentType:'application/json',headers:{apikey:config.key},payload:JSON.stringify({token_hash:flowDigest(token),action:action,payload:payload||{}}),muteHttpExceptions:true});
 var result=JSON.parse(response.getContentText());
 if(response.getResponseCode()!==200)throw new Error(result.message||'Não foi possível salvar no Ulbraflow.');
 return result;
}
function flowNotification(message) { return CardService.newActionResponseBuilder().setNotification(CardService.newNotification().setText(message)).build(); }
function flowConnect(event) {
 try{var token=flowInput(event,'flowToken').trim();if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Cole a chave gerada pelo Ulbraflow.');flowRpc('areas',{},token);PropertiesService.getUserProperties().setProperty('flowToken',token);return flowNotification('Conectado. Abra um e-mail para incluir no Ulbraflow.');}catch(error){return flowNotification(error.message);}
}
function flowDisconnect() { PropertiesService.getUserProperties().deleteProperty('flowToken');return flowNotification('Conexão removida deste complemento. Para revogar a chave, use Desconectar celular no Ulbraflow.'); }
function flowMessage(event) {
 if(!PropertiesService.getUserProperties().getProperty('flowToken'))return flowHome();
 try{
  GmailApp.setCurrentMessageAccessToken(event.gmail.accessToken);
  var message=GmailApp.getMessageById(event.gmail.messageId);
  if(!event.gmail.threadId)throw new Error('Abra uma conversa no Gmail.');
  var projects=flowRpc('areas').projects;
  var section=CardService.newCardSection();
  section.addWidget(CardService.newTextInput().setFieldName('title').setTitle('Título da demanda').setValue(message.getSubject().slice(0,180)));
  var areas=CardService.newSelectionInput().setFieldName('projectId').setTitle('Área').setType(CardService.SelectionInputType.DROPDOWN);
  projects.forEach(function(project,index){areas.addItem(project.name,project.id,index===0);});
  section.addWidget(areas).addWidget(CardService.newTextInput().setFieldName('dueDate').setTitle('Prazo final · AAAA-MM-DD').setHint('Exemplo: 2026-10-20'));
  var parameters={threadId:event.gmail.threadId,account:Session.getActiveUser().getEmail(),subject:message.getSubject().slice(0,180),sender:message.getFrom().slice(0,150)};
  section.addWidget(CardService.newTextButton().setText('Salvar no Ulbraflow').setOnClickAction(flowAction('flowSave',parameters)));
  section.addWidget(CardService.newTextButton().setText('Configurar conexão').setOnClickAction(flowAction('flowSettings')));
  return flowCard('Incluir no Ulbraflow').addSection(section).build();
 }catch(error){return flowCard('Ulbraflow').addSection(CardService.newCardSection().addWidget(CardService.newTextParagraph().setText(flowEscape(error.message)))).build();}
}
function flowEscape(value) { return String(value).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); }
function flowSettings() { return CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().pushCard(flowHome())).build(); }
function flowSave(event) {
 try{
  var parameters=event.commonEventObject.parameters;
  var title=flowInput(event,'title').trim(),due=flowInput(event,'dueDate'),project=flowInput(event,'projectId');
  if(!title||title.length>180||!project||!/^\d{4}-\d{2}-\d{2}$/.test(due))throw new Error('Preencha título, área e prazo no formato AAAA-MM-DD.');
  var result=flowRpc('save',{title:title,projectId:project,dueDate:due,gmailSubject:parameters.subject,gmailSender:parameters.sender,captureId:'gmail-mobile-'+parameters.threadId,gmailUrl:'https://mail.google.com/mail/?authuser='+encodeURIComponent(parameters.account)+'#all/'+parameters.threadId});
  var card=flowCard('Demanda salva').addSection(CardService.newCardSection().addWidget(CardService.newTextParagraph().setText(result.duplicate?'Esta conversa já está no Ulbraflow.':'Demanda incluída na esteira. Atualize o Ulbraflow para vê-la.')).addWidget(CardService.newTextButton().setText('Abrir Ulbraflow').setOpenLink(CardService.newOpenLink().setUrl(FLOW_ORIGIN)))).build();
  return CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().updateCard(card)).build();
 }catch(error){return flowNotification(error.message);}
}
