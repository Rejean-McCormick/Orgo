# ORGO / TANDEM EDUCATION / P4 AUTHENTICATED SESSION-BOUND READONLY

Extraire dans la racine du depot ORGO.

Ordre Windows : `PREVIEW_TANDEM_EDU_P4_ORGO.cmd`, puis `INSTALL_TANDEM_EDU_P4_ORGO.cmd`, puis `VERIFY_TANDEM_EDU_P4_ORGO.cmd`. Retour : `ROLLBACK_TANDEM_EDU_P4_ORGO.cmd`.

Aucun DB, Docker, VPS, service, route publique, utilisateur enfant, workflow ni autorisation runtime modifie. Le gestionnaire exige les SHA-256 exacts P3/snapshot; refuse toute divergence avant ecriture. Tests hors ligne sur copie temporaire.

Limites : cette phase ne raccorde pas les registres d'approbation enseignants/participants, ni les services de production, ni les reseaux de confiance. Les tests Nest/TypeScript avec dependances sont reportes.
