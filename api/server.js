// --- ARQUIVO: api/server.js (VERSÃO VERCEL 100% CORRIGIDA) ---

const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bodyParser = require('body-parser');
const cors = require('cors');
// const cron = require('node-cron'); // Removido para Vercel
const Mailgun = require('mailgun.js');
const formData = require('form-data'); 

require('dotenv').config();

// --- 1. CONFIGURAÇÕES ---
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = "agendamentos";
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const EMAIL_DE_ORIGEM = process.env.EMAIL_DE_ORIGEM;
// const PORT = 3000; // Removido para Vercel

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- 2. O BANCO DE DADOS ---
let db;
async function connectToDB() {
    try {
        const client = new MongoClient(MONGO_URI);
        await client.connect();
        db = client.db(DB_NAME);
        console.log(`Conectado ao MongoDB (${DB_NAME}) com sucesso.`);
    } catch (err) {
        console.error("Falha ao conectar ao MongoDB:", err);
        process.exit(1);
    }
}
connectToDB(); // Conecta ao iniciar

// --- 3. O SERVIDOR WEB (API) ---

// Endpoint /agendar (COM /api)
// Endpoint /agendar (COM /api)
app.post('/api/agendar', async (req, res) => { // ✨ ROTA CORRIGIDA
    if (!db) {
        return res.status(500).json({ error: "Banco de dados não conectado." });
    }
    try {
        const { remetenteNome, destinatario, assunto, mensagem, dataAgendada } = req.body; 
        if (!remetenteNome || !destinatario || !assunto || !mensagem) {
            return res.status(400).json({ error: "Remetente, destinatário, assunto e mensagem são obrigatórios." });
        }

        // --- INÍCIO DA CORREÇÃO DE FUSO E ENVIO ---

        const enviarAgora = !dataAgendada; 
        let dataParaAgendar;

        if (enviarAgora) {
            // 1. Se for envio imediato, apenas pega a hora UTC atual
            dataParaAgendar = new Date();
        } else {
            // 2. Se for agendado (ex: "2025-10-29T13:00")
            //    Nós ADICIONAMOS o fuso horário do Brasil (-03:00)
            //    Isso força o JS a salvar o UTC correto (16:00Z)
            dataParaAgendar = new Date(dataAgendada + "-03:00"); 
        }
        
        const novoAgendamento = {
            remetenteNome,
            destinatario,
            assunto,
            mensagem,
            dataAgendada: dataParaAgendar,
            status: enviarAgora ? "processando" : "pendente", 
            criadoEm: new Date()
        };
        // --- FIM DA CORREÇÃO ---

        const result = await db.collection(COLLECTION_NAME).insertOne(novoAgendamento);
        
        if (enviarAgora) {
            console.log("Envio imediato solicitado:", novoAgendamento.assunto);
            const tarefaParaEnviar = { ...novoAgendamento, _id: result.insertedId };
            await enviarEmail(tarefaParaEnviar); // Chama a função de envio
        } else {
            // Este log agora mostrará a data UTC correta (3h a mais)
            console.log("Agendamento salvo para o futuro:", novoAgendamento.assunto, "(UTC:", dataParaAgendar.toISOString(), ")");
        }

        res.status(201).json({ message: "Agendamento salvo com sucesso!" });

    } catch (err) {
        console.error("Erro ao salvar agendamento:", err);
        res.status(500).json({ error: "Erro interno ao salvar." });
    }
});

// Endpoint /historico (Com filtros e /api)
app.get('/api/historico', async (req, res) => { // ✨ ROTA CORRIGIDA
    if (!db) {
        return res.status(500).json({ error: "Banco de dados não conectado." });
    }
    try {
        const { search, status, sort } = req.query;
        let query = {};
        if (status) {
            query.status = status;
        }
        if (search) {
            const regex = { $regex: search, $options: 'i' };
            query.$or = [
                { assunto: regex },
                { destinatario: regex }
            ];
        }
        let sortOptions = { criadoEm: -1 }; 
        if (sort === 'antigos') {
            sortOptions = { criadoEm: 1 };
        }
        const historico = await db.collection(COLLECTION_NAME)
            .find(query)
            .sort(sortOptions)
            .limit(50)
            .toArray();
        res.json(historico);
    } catch (err) {
        console.error("Erro ao buscar histórico:", err);
        res.status(500).json({ error: "Erro interno ao buscar." });
    }
});

// Endpoint /concluir (COM /api)
app.patch('/api/tarefa/:id/concluir', async (req, res) => { // ✨ ROTA CORRIGIDA
    if (!db) {
        return res.status(500).json({ error: "Banco de dados não conectado." });
    }
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "ID inválido." });
        }
        const tarefa = await db.collection(COLLECTION_NAME).findOne({ _id: new ObjectId(id) });
        if (!tarefa) {
            return res.status(404).json({ error: "Tarefa não encontrada." });
        }
        if (tarefa.status === 'concluida') {
            return res.status(200).json({ message: "Tarefa já estava concluída." });
        }
        await db.collection(COLLECTION_NAME).updateOne(
            { _id: tarefa._id },
            { $set: { status: "concluida" } }
        );
        if (tarefa.mailgunMessageId && tarefa.status === 'enviado') {
            console.log(`Enviando e-mail de conclusão para: ${tarefa.assunto}`);
            await enviarEmailConclusao(tarefa); 
        }
        res.status(200).json({ message: "Tarefa marcada como concluída!" });
    } catch (err) {
        console.error("Erro ao concluir tarefa:", err);
        res.status(500).json({ error: "Erro interno ao atualizar." });
    }
});

// Endpoint de Exclusão (COM /api)
app.delete('/api/tarefa/:id', async (req, res) => { // ✨ ROTA CORRIGIDA
    if (!db) {
        return res.status(500).json({ error: "Banco de dados não conectado." });
    }
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "ID inválido." });
        }
        const result = await db.collection(COLLECTION_NAME).deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Tarefa não encontrada para exclusão." });
        }
        console.log(`Tarefa ${id} excluída com sucesso.`);
        res.status(200).json({ message: "Tarefa excluída com sucesso!" });
    } catch (err) {
        console.error("Erro ao excluir tarefa:", err);
        res.status(500).json({ error: "Erro interno ao excluir." });
    }
});

// Endpoint para o Cron Job da Vercel (Já estava correto)
app.get('/api/cron', async (req, res) => {
    console.log("Cron Job da Vercel iniciado...");
    // Você pode adicionar uma chave de segurança aqui depois
    await verificarEEnviarEmails(); 
    res.status(200).json({ message: "Cron job executado." });
});


// --- 4. O "CARTEIRO" (MAILGUN) ---

const mailgun = new Mailgun(formData);
const mgClient = mailgun.client({
    username: 'api',
    key: MAILGUN_API_KEY
});

function gerarTemplateHTML(assunto, mensagem) {
    const mensagemFormatada = mensagem.replace(/\n/g, '<br>');
    return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="pt">
 <head>
  <meta charset="UTF-8">
  <meta content="width=device-width, initial-scale=1" name="viewport">
  <meta name="x-apple-disable-message-reformatting">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta content="telephone=no" name="format-detection">
  <title>Novo modelo de e-mail 2025-10-28</title><link href="https://fonts.googleapis.com/css2?family=Alex+Brush&display=swap" rel="stylesheet"><style type="text/css">
.rollover:hover .rollover-first {
  max-height:0px!important;
  display:none!important;
}
.rollover:hover .rollover-second {
  max-height:none!important;
  display:block!important;
}
.rollover span {
  font-size:0px;
}
u + .body img ~ div div {
  display:none;
}
#outlook a {
  padding:0;
}
span.MsoHyperlink,
span.MsoHyperlinkFollowed {
  color:inherit;
  mso-style-priority:99;
}
a.es-button {
  mso-style-priority:100!important;
  text-decoration:none!important;
}
a[x-apple-data-detectors],
#MessageViewBody a {
  color:inherit!important;
  text-decoration:none!important;
  font-size:inherit!important;
  font-family:inherit!important;
  font-weight:inherit!important;
  line-height:inherit!important;
}
.es-desk-hidden {
  display:none;
  float:left;
  overflow:hidden;
  width:0;
  max-height:0;
  line-height:0;
  mso-hide:all;
}
@media only screen and (max-width:600px) {.es-m-p20t { padding-top:20px!important } .es-m-p20r { padding-right:20px!important } .es-m-p20l { padding-left:20px!important } .es-m-p0r { padding-right:0px!important } .es-m-p10b { padding-bottom:10px!important } .es-p-default { } *[class="gmail-fix"] { display:none!important } p, a { line-height:150%!important } h1, h1 a { line-height:120%!important } h2, h2 a { line-height:120%!important } h3, h3 a { line-height:120%!important } h4, h4 a { line-height:120%!important } h5, h5 a { line-height:120%!important } h6, h6 a { line-height:120%!important } .es-header-body p { } .es-content-body p { } .es-footer-body p { } .es-infoblock p { } h1 { font-size:30px!important; text-align:center } h2 { font-size:26px!important; text-align:center } h3 { font-size:20px!important; text-align:left } h4 { font-size:24px!important; text-align:left } h5 { font-size:20px!important; text-align:left } h6 { font-size:16px!important; text-align:left } .es-header-body h1 a, .es-content-body h1 a, .es-footer-body h1 a { font-size:30px!important } .es-header-body h2 a, .es-content-body h2 a, .es-footer-body h2 a { font-size:26px!important } .es-header-body h3 a, .es-content-body h3 a, .es-footer-body h3 a { font-size:20px!important } .es-header-body h4 a, .es-content-body h4 a, .es-footer-body h4 a { font-size:24px!important } .es-header-body h5 a, .es-content-body h5 a, .es-footer-body h5 a { font-size:20px!important } .es-header-body h6 a, .es-content-body h6 a, .es-footer-body h6 a { font-size:16px!important } .es-menu td a { font-size:14px!important } .es-header-body p, .es-header-body a { font-size:14px!important } .es-content-body p, .es-content-body a { font-size:14px!important } .es-footer-body p, .es-footer-body a { font-size:14px!important } .es-infoblock p, .es-infoblock a { font-size:12px!important } .es-m-txt-c, .es-m-txt-c h1, .es-m-txt-c h2, .es-m-txt-c h3, .es-m-txt-c h4, .es-m-txt-c h5, .es-m-txt-c h6 { text-align:center!important } .es-m-txt-r, .es-m-txt-r h1, .es-m-txt-r h2, .es-m-txt-r h3, .es-m-txt-r h4, .es-m-txt-r h5, .es-m-txt-r h6 { text-align:right!important } .es-m-txt-j, .es-m-txt-j h1, .es-m-txt-j h2, .es-m-txt-j h3, .es-m-txt-j h4, .es-m-txt-j h5, .es-m-txt-j h6 { text-align:justify!important } .es-m-txt-l, .es-m-txt-l h1, .es-m-txt-l h2, .es-m-txt-l h3, .es-m-txt-l h4, .es-m-txt-l h5, .es-m-txt-l h6 { text-align:left!important } .es-m-txt-r img, .es-m-txt-c img, .es-m-txt-l img { display:inline!important } .es-m-txt-r .rollover:hover .rollover-second, .es-m-txt-c .rollover:hover .rollover-second, .es-m-txt-l .rollover:hover .rollover-second { display:inline!important } .es-m-txt-r .rollover span, .es-m-txt-c .rollover span, .es-m-txt-l .rollover span { line-height:0!important; font-size:0!important; display:block } .es-spacer { display:inline-table } a.es-button, button.es-button { font-size:18px!important; padding:10px 20px 10px 20px!important; line-height:120%!important } a.es-button, button.es-button, .es-button-border { display:inline-block!important } .es-m-fw, .es-m-fw.es-fw, .es-m-fw .es-button { display:block!important } .es-m-il, .es-m-il .es-button, .es-social, .es-social td, .es-menu.es-table-not-adapt { display:inline-block!important } .es-adaptive table, .es-left, .es-right { width:100%!important } .es-content table, .es-header table, .es-footer table, .es-content, .es-footer, .es-header { width:100%!important; max-width:600px!important } .adapt-img { width:100%!important; height:auto!important } .es-adapt-td { display:block!important; width:100%!important } .es-mobile-hidden, .es-hidden { display:none!important } .es-container-hidden { display:none!important } .es-desk-hidden { width:auto!important; overflow:visible!important; float:none!important; max-height:inherit!important; line-height:inherit!important } tr.es-desk-hidden { display:table-row!important } table.es-desk-hidden { display:table!important } td.es-desk-menu-hidden { display:table-cell!important } .es-menu td { width:1%!important } table.es-table-not-adapt, .esd-block-html table { width:auto!important } .h-auto { height:auto!important } }
@media screen and (max-width:384px) {.mail-message-content { width:414px!important } }
</style>
 </head>
 <body class="body" style="width:100%;height:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;padding:0;Margin:0">
  <div dir="ltr" class="es-wrapper-color" lang="pt" style="background-color:#D6CED5"><table width="100%" cellspacing="0" cellpadding="0" class="es-wrapper" role="none" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;padding:0;Margin:0;width:100%;height:100%;background-repeat:repeat;background-position:center top;background-color:#D6CED5">
     <tr>
      <td valign="top" style="padding:0;Margin:0">
       <table cellspacing="0" cellpadding="0" align="center" class="es-content" role="none" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;width:100%;table-layout:fixed !important">
         <tr>
          <td align="center" style="padding:0;Margin:0">
           <table cellspacing="0" cellpadding="0" bgcolor="#ffffff" align="center" class="es-content-body" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;background-color:#ffffff;width:600px" role="none">
             <tr>
              <td align="left" class="es-m-p20t es-m-p20r es-m-p20l" style="padding:0;Margin:0;padding-top:40px;padding-right:40px;padding-left:40px">
               <table width="100%" cellspacing="0" cellpadding="0" role="none" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                 <tr>
                  <td valign="top" align="center" class="es-m-p0r" style="padding:0;Margin:0;width:520px">
                   <table width="100%" cellspacing="0" cellpadding="0" role="presentation" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                     <tr>
                      <td align="center" style="padding:0;Margin:0;padding-top:5px;padding-bottom:5px"><h3 style="Margin:0;font-family:'courier new', courier, 'lucida sans typewriter', 'lucida typewriter', monospace;mso-line-height-rule:exactly;letter-spacing:0;font-size:24px;font-style:normal;font-weight:normal;line-height:28.8px;color:#333333">— ${assunto} —</h3></td>
                     </tr>
                   </table></td>
                 </tr>
               </table></td>
             </tr>
             <tr>
              <td align="left" class="es-m-p10b es-m-p20r es-m-p20l" style="Margin:0;padding-right:40px;padding-left:40px;padding-top:10px;padding-bottom:20px">
               <table cellpadding="0" cellspacing="0" width="100%" role="none" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                 <tr>
                  <td align="center" valign="top" style="padding:0;Margin:0;width:520px">
                   <table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                     <tr>
                      <td align="left" style="padding:0;Margin:0;padding-top:10px;padding-bottom:10px"><p style="Margin:0;mso-line-height-rule:exactly;font-family:'courier new', courier, 'lucida sans typewriter', 'lucida typewriter', monospace;line-height:16.8px;letter-spacing:0;color:#333333;font-size:14px">${mensagemFormatada}</p></td>
                     </tr>
                   </table></td>
                 </tr>
               </table></td>
             </tr>
             <tr>
              <td align="left" bgcolor="#333333" style="padding:0;Margin:0;background-color:#333333;border-radius:4px">
               <table width="100%" cellpadding="0" cellspacing="0" role="none" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px">
                 <tr>
                  <td align="left" style="padding:0;Margin:0;">
                   <table cellpadding="0" cellspacing="0" role="presentation" width="100%" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;border-radius:40px">
                     <tr>
                      <td align="center" style="padding:0;Margin:0;font-size:0"><img src="https://evgorom.stripocdn.email/content/guids/CABINET_db042e45de0793c266fb982474b1eab9912f5c7b947b8a0294dd2669147cb05f/images/cartao_dobrado_horizontal_monocromatico_imobiliaria_elegante_em_vermelhoescuro_1_wbm.png" alt="" class="adapt-img" style="display:block;font-size:14px;border:0;outline:none;text-decoration:none;margin:0; width: 100%; height: auto;"></td>
                     </tr>
                   </table></td>
                 </tr>
               </table></td>
             </tr>
           </table></td>
         </tr>
       </table></td>
     </tr>
   </table>
  </div>
 </body>
</html>
    `;
}

async function enviarEmailConclusao(tarefa) {
    const assuntoConclusao = `Re: ${tarefa.assunto}`;
    const mensagemConclusao = `A tarefa "${tarefa.assunto}" foi marcada como concluída com sucesso.`;
    const corpoHTMLEmail = gerarTemplateHTML(assuntoConclusao, mensagemConclusao);
    const messageData = {
        from: `${tarefa.remetenteNome} <${EMAIL_DE_ORIGEM}>`, 
        to: tarefa.destinatario,
        subject: assuntoConclusao,
        text: mensagemConclusao, 
        html: corpoHTMLEmail,
        'h:In-Reply-To': tarefa.mailgunMessageId,
        'h:References': tarefa.mailgunMessageId
    };
    try {
        const result = await mgClient.messages.create(MAILGUN_DOMAIN, messageData);
        console.log(`E-mail de conclusão enviado com sucesso! ID: ${result.id}`);
    } catch (err) {
        console.error("Falha ao enviar e-mail de conclusão:", err.message);
A   }
}

async function enviarEmail(tarefa) {
    console.log(`Tentando enviar e-mail para: ${tarefa.destinatario}`);
    const corpoHTMLEmail = gerarTemplateHTML(tarefa.assunto, tarefa.mensagem);
    const messageData = {
        from: `${tarefa.remetenteNome} <${EMAIL_DE_ORIGEM}>`, 
        to: tarefa.destinatario,
        subject: tarefa.assunto,
        text: tarefa.mensagem, 
        html: corpoHTMLEmail
    };
    try {
        const result = await mgClient.messages.create(MAILGUN_DOMAIN, messageData);
        console.log("Email enviado com sucesso!", result.id);
        await db.collection(COLLECTION_NAME).updateOne(
            { _id: tarefa._id },
            { $set: { 
                status: "enviado", 
                dataEnvio: new Date(),
                mailgunMessageId: result.id 
              } 
            }
        );
    } catch (err) {
        console.error("Erro ao enviar e-mail (Mailgun):", err.message);
        await db.collection(COLLECTION_NAME).updateOne(
            { _id: tarefa._id },
            { $set: { status: "erro", erroMsg: err.message } }
       );
    }
}

// --- 5. O AGENDADOR (CRON JOB) ---
// A função de verificação fica, mas o agendador (cron.schedule) é removido
async function verificarEEnviarEmails() {
    if (!db) {
        console.log("Cron: Conexão com DB ainda não estabelecida.");
        return; 
    }
    const agora = new Date();
    const tarefasPendentes = await db.collection(COLLECTION_NAME).find({
        status: "pendente",
        dataAgendada: { $lte: agora }
    }).toArray();

    if (tarefasPendentes.length > 0) {
        console.log(`Cron: Encontradas ${tarefasPendentes.length} tarefas pendentes.`);
        for (const tarefa of tarefasPendentes) {
            await db.collection(COLLECTION_NAME).updateOne(
                { _id: tarefa._id },
              { $set: { status: "processando" } }
            );
            await enviarEmail(tarefa);
        }
    } else {
        console.log("Cron: Nenhuma tarefa pendente encontrada.");
    }
}

// --- 6. INICIALIZAÇÃO ---
// REMOVIDO "startServer" e "app.listen"

// ✨✨✨ ADICIONADO: EXPORTA O APP PARA A VERCEL ✨✨✨
module.exports = app;