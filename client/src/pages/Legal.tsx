import { Download, ShieldCheck, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

/**
 * Pages légales (CGU, confidentialité, mentions légales) et droits sur les données.
 * Textes de travail, rédigés pour KOFI : ils doivent être relus et validés par un juriste avant l’ouverture au public.
 * Les éléments entre crochets [ … ] sont à compléter avec les informations de l’éditeur.
 */

export type LegalKind = "cgu" | "privacy" | "mentions";
const UPDATED = "18 novembre 2026";

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return <main className="kofi-container kofi-page">
    <h1 className="kofi-page-title">{title}</h1>
    <div className="kofi-panel kofi-legal">
      <p className="kofi-legal-draft"><ShieldCheck size={15} /> Version de travail du {UPDATED}, à faire valider par un juriste avant l’ouverture au public.</p>
      {children}
      <nav className="kofi-legal-nav" aria-label="Documents légaux"><Link href="/cgu">Conditions d’utilisation</Link><Link href="/confidentialite">Confidentialité</Link><Link href="/mentions-legales">Mentions légales</Link></nav>
    </div>
  </main>;
}

export function LegalDocument({ kind }: { kind: LegalKind }) {
  if (kind === "mentions") return <Doc title="Mentions légales">
    <h2>Éditeur du site</h2>
    <p>KOFI est édité par [raison sociale], [forme juridique] au capital de [montant] FCFA, immatriculée au registre du commerce de [ville] sous le numéro [RCCM], numéro contribuable [NIU], dont le siège est situé [adresse], Cameroun.</p>
    <p>Directeur de la publication : [nom]. Contact : [adresse e-mail de contact] · [téléphone].</p>
    <h2>Hébergement</h2>
    <p>Le site est hébergé par [nom de l’hébergeur], [adresse], [site web].</p>
    <h2>Propriété intellectuelle</h2>
    <p>La marque KOFI, le logo, la charte graphique et le code du site appartiennent à l’éditeur. Les photos et textes publiés par les professionnels restent leur propriété ; ils accordent à KOFI le droit de les afficher sur la plateforme le temps de leur inscription.</p>
    <h2>Signalement d’un contenu</h2>
    <p>Un contenu illicite ou inexact peut être signalé depuis l’espace « Mes réservations » (bouton « Signaler ») ou à [adresse e-mail de contact]. Il est examiné par l’équipe de modération.</p>
  </Doc>;

  if (kind === "privacy") return <Doc title="Politique de confidentialité">
    <p>Cette politique explique quelles données KOFI collecte, pourquoi, combien de temps elles sont gardées et comment exercer vos droits. Elle s’applique au site et à l’application mobile KOFI.</p>
    <h2>Responsable du traitement</h2>
    <p>[Raison sociale], [adresse], joignable à [adresse e-mail dédiée à la vie privée].</p>
    <h2>Données collectées et finalités</h2>
    <ul>
      <li><strong>Compte</strong> : nom, adresse e-mail, mot de passe (stocké uniquement sous forme d’empreinte chiffrée), date de création et de dernière connexion. Sert à vous identifier et à sécuriser votre compte.</li>
      <li><strong>Réservations</strong> : professionnel, prestations, date, prix, nom et téléphone saisis, adresse pour un rendez-vous à domicile, notes. Sert à exécuter la réservation et à vous prévenir (site, e-mail, SMS).</li>
      <li><strong>Paiements</strong> : montant, opérateur (MTN / Orange), numéro de téléphone payeur, statut. KOFI ne voit ni ne conserve votre code secret Mobile Money.</li>
      <li><strong>Avis, signalements, favoris, points de fidélité, cartes cadeaux</strong> : pour faire fonctionner ces services.</li>
      <li><strong>Professionnels</strong> : profil public (nom, salon, ville, quartier, prestations, tarifs, horaires, photos, équipe) et données nécessaires aux reversements.</li>
      <li><strong>Sécurité</strong> : adresse IP lors des connexions (limitation des essais), journal des actions de l’équipe KOFI.</li>
    </ul>
    <p>KOFI ne vend pas vos données et n’affiche pas de publicité ciblée.</p>
    <h2>Destinataires</h2>
    <p>Le professionnel que vous réservez voit votre nom, votre téléphone, vos prestations et vos notes. Nos prestataires techniques n’accèdent aux données que pour leur mission : hébergement, paiement Mobile Money, envoi d’e-mails et de SMS. L’équipe KOFI y accède selon son rôle (support, modération, administration).</p>
    <h2>Durées de conservation</h2>
    <ul>
      <li>Compte : tant qu’il est actif. Après suppression, les données d’identité sont effacées.</li>
      <li>Réservations et paiements : [10 ans / durée légale comptable], anonymisés si vous supprimez votre compte.</li>
      <li>Liens de connexion et de vérification : quelques heures. Journaux de sécurité : [12 mois].</li>
    </ul>
    <h2>Vos droits</h2>
    <p>Conformément à la législation camerounaise sur la protection des données personnelles et la cybersécurité, vous pouvez accéder à vos données, les faire rectifier ou supprimer, et vous opposer à certains traitements.</p>
    <ul>
      <li>Depuis « Mon compte », vous pouvez <strong>télécharger toutes vos données</strong> et <strong>supprimer votre compte</strong> vous-même.</li>
      <li>Pour toute autre demande, écrivez à [adresse e-mail dédiée à la vie privée].</li>
    </ul>
    <h2>Sécurité</h2>
    <ul>
      <li>Connexions chiffrées (HTTPS) et mots de passe jamais stockés en clair.</li>
      <li>Double vérification obligatoire pour l’équipe d’administration.</li>
      <li>Accès limités selon les rôles, et sauvegardes protégées.</li>
    </ul>
    <h2>Cookies</h2>
    <p>KOFI utilise uniquement un cookie de session, indispensable pour rester connecté, et un stockage local pour retenir votre réservation en cours et le fonctionnement hors connexion. Aucun cookie publicitaire ni de mesure d’audience tierce.</p>
  </Doc>;

  return <Doc title="Conditions générales d’utilisation">
    <p>Les présentes conditions encadrent l’utilisation de KOFI, plateforme de mise en relation entre des clients et des professionnels de la beauté au Cameroun (coiffure, barbier, tresses, ongles, maquillage, esthétique). En créant un compte ou en réservant, vous les acceptez.</p>
    <h2>1. Rôle de KOFI</h2>
    <p>KOFI publie les profils, les tarifs et les disponibilités des professionnels et transmet les demandes de rendez-vous. La prestation elle-même est réalisée sous la seule responsabilité du professionnel. KOFI vérifie l’identité des professionnels avant de leur attribuer le badge « Vérifié ».</p>
    <h2>2. Compte</h2>
    <p>Vous devez fournir des informations exactes et garder votre mot de passe confidentiel. Un compte est personnel. KOFI peut suspendre un compte en cas de fraude, d’abus ou de non-respect des présentes conditions ; le motif est enregistré.</p>
    <h2>3. Réservation</h2>
    <p>Une demande devient un rendez-vous lorsque le professionnel la confirme : vous êtes prévenu sur le site, par e-mail si votre adresse est vérifiée, et par SMS. Les prix affichés sont en FCFA, toutes remises comprises (heures creuses, code promo, points de fidélité, carte cadeau).</p>
    <h2>4. Paiement</h2>
    <p>Lorsque le paiement en ligne est proposé, il se fait par Mobile Money (MTN MoMo, Orange Money) après la confirmation du professionnel, pour [la totalité / un acompte de N %]. KOFI perçoit une commission de [N %] sur les montants encaissés et reverse le solde au professionnel.</p>
    <h2>5. Annulation, déplacement, absence</h2>
    <p>Vous pouvez annuler ou déplacer gratuitement un rendez-vous jusqu’à [24] heures avant son début. Au-delà, [conditions à définir]. Un paiement effectué pour un rendez-vous annulé dans les délais, refusé ou annulé par le professionnel est remboursé sur le compte Mobile Money d’origine. En cas d’absence non prévenue, [conditions à définir].</p>
    <h2>6. Avis</h2>
    <p>Seul un client dont le rendez-vous a eu lieu peut laisser un avis, une seule fois, dans les 30 jours. Les avis doivent rester respectueux et porter sur la prestation ; KOFI peut masquer un avis abusif. Le professionnel peut répondre publiquement.</p>
    <h2>7. Fidélité et cartes cadeaux</h2>
    <p>Les points sont gagnés sur les rendez-vous terminés (1 point par tranche de 100 FCFA) et valent 500 FCFA les 100 points, dans la limite de 50 % du prix. Ils n’ont pas de valeur monétaire hors de KOFI. Une carte cadeau est valable 1 an à partir de son paiement, utilisable en plusieurs fois, et n’est ni remboursable ni échangeable contre de l’argent.</p>
    <h2>8. Engagements des professionnels</h2>
    <p>Le professionnel garantit l’exactitude de ses tarifs, horaires et photos, honore les rendez-vous confirmés et respecte les règles d’hygiène et de sécurité de son métier. Il est seul responsable de ses obligations fiscales et sociales.</p>
    <h2>9. Responsabilité</h2>
    <p>KOFI met tout en œuvre pour que le service soit disponible et sûr, sans pouvoir garantir l’absence totale d’interruption. KOFI n’est pas partie au contrat de prestation entre le client et le professionnel.</p>
    <h2>10. Droit applicable et litiges</h2>
    <p>Les présentes conditions sont soumises au droit camerounais. En cas de difficulté, contactez d’abord le support KOFI (bouton « Signaler » ou [adresse e-mail]). À défaut d’accord amiable, les tribunaux compétents de [ville] seront saisis.</p>
  </Doc>;
}

/** « Mon compte » : télécharger ses données et supprimer son compte. */
export function AccountDataSection({ onDeleted }: { onDeleted: () => void }) {
  const utils = trpc.useUtils();
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [downloading, setDownloading] = useState(false);
  const remove = trpc.auth.deleteMyAccount.useMutation({ onSuccess: () => { setPassword(""); onDeleted(); } });
  const download = async () => {
    setDownloading(true);
    try {
      const data = await utils.auth.exportMyData.fetch();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `kofi-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally { setDownloading(false); }
  };
  const error = remove.error ? ({ INVALID_CREDENTIALS: "Mot de passe incorrect.", ACCOUNT_HAS_UPCOMING_BOOKINGS: "Vous avez des rendez-vous à venir : annulez-les d’abord depuis « Mes réservations » (ou votre espace pro).", DELETE_CONFIRM_REQUIRED: "Tapez SUPPRIMER pour confirmer.", ACCOUNT_PROTECTED: "Les comptes de l’équipe KOFI sont retirés par le super-administrateur." } as Record<string, string>)[remove.error.message] ?? "La suppression a échoué. Réessayez." : null;
  const submit = (event: FormEvent) => { event.preventDefault(); remove.mutate({ password, confirm }); };
  return <section className="kofi-account-data">
    <h2>Mes données</h2>
    <p>Vous pouvez télécharger une copie de tout ce que KOFI garde sur votre compte, ou supprimer votre compte. Voir la <Link href="/confidentialite" className="kofi-link">politique de confidentialité</Link>.</p>
    <div className="kofi-hero-actions" style={{ justifyContent: "center" }}>
      <button type="button" className="kofi-button outline small" onClick={() => void download()} disabled={downloading}><Download size={15} /> {downloading ? "Préparation…" : "Télécharger mes données"}</button>
      {!asking && <button type="button" className="kofi-button kofi-danger small" onClick={() => setAsking(true)}><Trash2 size={15} /> Supprimer mon compte</button>}
    </div>
    {asking && <form onSubmit={submit} className="kofi-account-delete">
      <p><strong>La suppression est définitive.</strong> Vos favoris, points de fidélité et notifications sont effacés ; vos anciens rendez-vous restent dans l’historique des professionnels, sans votre nom ni votre téléphone. Une carte cadeau non utilisée sera perdue.</p>
      <div className="kofi-form-group"><label htmlFor="delete-password">Mot de passe</label><input id="delete-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></div>
      <div className="kofi-form-group"><label htmlFor="delete-confirm">Tapez SUPPRIMER pour confirmer</label><input id="delete-confirm" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" /></div>
      {error && <div className="kofi-alert" role="alert"><X size={16} /> {error}</div>}
      <div className="kofi-hero-actions" style={{ justifyContent: "center" }}>
        <button type="submit" className="kofi-button kofi-danger small" disabled={remove.isPending || confirm.trim().toUpperCase() !== "SUPPRIMER"}>{remove.isPending ? "Suppression…" : "Supprimer définitivement"}</button>
        <button type="button" className="kofi-button outline small" onClick={() => { setAsking(false); remove.reset(); }}>Annuler</button>
      </div>
    </form>}
  </section>;
}
