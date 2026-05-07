# Carte thermique géographique · Pesticides Hauts-de-France

Application web statique et interactive pour visualiser les concentrations de pesticides et de métabolites dans l’eau distribuée dans les Hauts-de-France, avec une analyse IA explicable pour prioriser la surveillance.

## Contenu de l’application

- Carte choroplèthe sur les contours réels des communes.
- Les mesures sont regroupées par **code postal**.
- Filtres par molécule, année, échelle de couleur et dépassements.
- Couche affichée : **concentration mesurée**.
- Infobulles au survol et panneau de détail au clic.
- Classement des codes postaux avec les valeurs les plus élevées.
- Module **Analyse IA** avec les codes postaux à surveiller en priorité.
- Synthèse par département.
- Module d’évolution temporelle pour suivre les tendances de 2016 à 2023 lorsque les données existent.
- Mini-historique par code postal dans le panneau de détail.
- Export CSV de la molécule et de l’année actuellement sélectionnées.

## Données intégrées

Le fichier `data/pesticides.json` contient maintenant :

- Chloridazone, 2016–2023 ;
- Chloridazone desphenyl, 2016–2023 ;
- Chloridazone methyl desphenyl, 2016–2023 ;
- Bentazone, 2016–2023 ;
- Pesticides totaux, 2016–2023 ;
- Chlorothalonil R471811, 2023.

Les lignes hors Hauts-de-France sont exclues à partir du préfixe du code postal. Les exports CSV sont générés uniquement avec les lignes correspondant à l’année sélectionnée dans l’interface.

## Lancer sur le port 8080

```bash
cd hauts-de-france-heatmap-project
python3 -m http.server 8080
```

Puis ouvrir :

```text
http://localhost:8080
```

Ou via npm :

```bash
npm start
```

## Stack technique

- **HTML5** pour la structure de page.
- **CSS3** pour la mise en page, les panels, les cartes, les gradients et le responsive design.
- **JavaScript natif / Vanilla JS** pour l’interactivité, les filtres, l’agrégation, les calculs de tendance, l’export CSV et l’analyse IA.
- **Leaflet.js** pour la carte interactive.
- **OpenStreetMap** pour le fond cartographique.
- **GeoJSON** pour les contours communaux.
- **geo.api.gouv.fr** pour récupérer les communes et leurs codes postaux.
- **JSON local** pour les mesures : `data/pesticides.json`.

L’application ne nécessite aucun backend, aucune base de données et aucune étape de build. Elle peut être hébergée gratuitement sur GitHub Pages, Netlify ou Vercel.

## Comment l’IA est utilisée

L’IA intégrée est volontairement **locale, légère et explicable**. Elle ne fait pas appel à une API externe et ne remplace pas une évaluation sanitaire officielle. Elle sert à aider l’utilisateur à repérer les zones qui méritent une attention prioritaire.

Pour chaque combinaison **molécule + code postal**, le modèle calcule un score entre 0 et 100 à partir de plusieurs variables dérivées des données historiques :

- concentration récente ;
- maximum historique ;
- fréquence des dépassements ;
- pente temporelle, c’est-à-dire tendance à la hausse ou à la baisse ;
- variabilité des valeurs ;
- manque éventuel de données ou données anciennes.

Le score est ensuite transformé en niveau de priorité :

```text
priorité faible
priorité modérée
priorité élevée
```

## Fonctionnement géographique

Les contours communaux sont récupérés à l’ouverture via l’API publique française `geo.api.gouv.fr`, avec les codes postaux associés aux communes. La carte colore chaque commune selon la valeur agrégée de son code postal. Si une commune possède plusieurs codes postaux, l’application retient la valeur la plus élevée disponible pour la combinaison molécule + année sélectionnée.

Une connexion Internet est nécessaire au premier chargement pour récupérer les contours géographiques. Ensuite, le navigateur peut souvent réutiliser le cache local.
