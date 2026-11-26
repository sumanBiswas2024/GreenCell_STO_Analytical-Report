sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/ui/export/Spreadsheet",
	"sap/viz/ui5/controls/Popover",
	"sap/m/MessageToast"
], function(Controller, JSONModel, Filter, FilterOperator, Spreadsheet, VizPopover, MessageToast) {
	"use strict";

	var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	var DOC_FIELDS = {
		pgi: "pgi_docs",
		grn: "grn_docs",
		miro: "miro_docs"
	};

	return Controller.extend("Z_STO_Report_GC.controller.STO_Dashboard", {
		onInit: function() {
			var year = String(new Date().getFullYear());
			var years = [];
			for (var i = Number(year) - 4; i <= Number(year) + 1; i++) {
				years.push({
					key: String(i),
					text: String(i)
				});
			}
			this._viewModel = new JSONModel({
				year: year,
				years: years,
				plantDraft: "",
				plantContext: "—",
				plantBusy: false,
				monthlyBusy: false,
				plantVisible: false,
				monthlyVisible: false,
				summaryVisible: false,
				emptyVisible: false,
				promptVisible: true,
				error: "",
				plantError: "",
				monthlyError: "",
				plantTitle: "Plant-wise STO Overview",
				monthlyTitle: "Monthly STO Analysis",
				kpi: {
					po: "–",
					plantCaption: "Select supplying plant",
					pgiDocs: "–",
					grnDocs: "–",
					miroDocs: "–"
				}
			});
			this.getView().setModel(this._viewModel, "view");
			this.getView().setModel(new JSONModel({
				byPlant: [],
				byValue: [],
				table: []
			}), "plant");
			this.getView().setModel(new JSONModel({
				byMonth: [],
				byMonthlyPlant: [],
				totals: {
					pgi: "0",
					grn: "0"
				},
				table: []
			}), "monthly");
			this._committedPlant = "";
			this._plantLoaded = false;
			this._monthlyLoaded = false;
			this._chartPopoverById = {};
			this._chartPopoverUid = {};
			["plantPoChart", "plantValueChart", "monthlyTrendChart", "monthlyPlantChart"].forEach(function(chartId) {
				var popover = new VizPopover();
				this.getView().addDependent(popover);
				this._chartPopoverById[chartId] = popover;
			}, this);
			this._chartPopoverById.plantValueChart.setFormatString({
				"PGI Value (INR Lakh)": "#,##0.0"
			});
		},

		onAfterRendering: function() {
			Object.keys(this._chartPopoverById).forEach(function(chartId) {
				this._connectChartPopover(chartId);
			}, this);
		},

		onChartRenderComplete: function(event) {
			var chart = event.getSource();
			Object.keys(this._chartPopoverById).some(function(chartId) {
				if (this.byId(chartId) === chart) {
					this._connectChartPopover(chartId);
					return true;
				}
				return false;
			}, this);
		},

		_connectChartPopover: function(chartId) {
			var chart = this.byId(chartId);
			var legendRequired = chartId === "plantValueChart";
			if (legendRequired && chart && chart.getLegendVisible && !chart.getLegendVisible()) {
				chart.setLegendVisible(true);
			}
			var uid = chart && chart.getVizUid && chart.getVizUid();
			if (uid && this._chartPopoverUid[chartId] !== uid) {
				this._chartPopoverById[chartId].connect(uid);
				this._chartPopoverUid[chartId] = uid;
			}
		},

		onPlantSubmit: function(oEvent) {
			var input = oEvent.getSource();
			var plant = input.getValue().trim().toUpperCase();
			input.setValue(plant);
			this._viewModel.setProperty("/plantDraft", plant);
		},

		onGo: function() {
			var input = this.byId("plantInput");
			var plant = (input.getValue() || this._viewModel.getProperty("/plantDraft") || "").trim().toUpperCase();
			if (!plant) {
				input.setValueState("Error");
				input.setValueStateText("Enter one supplying plant code.");
				MessageToast.show("Enter one supplying plant code.");
				return;
			}
			if (/[;,\s]/.test(plant)) {
				input.setValueState("Error");
				input.setValueStateText("Enter only one supplying plant code.");
				MessageToast.show("Only one supplying plant can be entered.");
				return;
			}
			input.setValueState("None");
			input.setValue(plant);
			this._viewModel.setProperty("/plantDraft", plant);
			this._committedPlant = plant;
			this._viewModel.setProperty("/plantContext", plant);
			this._updateSectionTitles();
			this._plantLoaded = false;
			this._monthlyLoaded = false;
			this._viewModel.setProperty("/error", "");
			this._viewModel.setProperty("/plantError", "");
			this._viewModel.setProperty("/monthlyError", "");
			this._viewModel.setProperty("/plantVisible", false);
			this._viewModel.setProperty("/monthlyVisible", false);
			this._viewModel.setProperty("/summaryVisible", false);
			this._viewModel.setProperty("/emptyVisible", false);
			this._viewModel.setProperty("/promptVisible", false);
			this.getView().getModel("plant").setData({
				byPlant: [],
				byValue: [],
				table: []
			});
			this.getView().getModel("monthly").setData({
				byMonth: [],
				byMonthlyPlant: [],
				totals: {
					pgi: "0",
					grn: "0"
				},
				table: []
			});
			this._viewModel.setProperty("/plantBusy", true);
			this._viewModel.setProperty("/monthlyBusy", true);
			this._viewModel.setProperty("/kpi/po", "–");
			this._viewModel.setProperty("/kpi/plantCaption", "Loading plant summary…");
			this._viewModel.setProperty("/kpi/pgiDocs", "–");
			this._viewModel.setProperty("/kpi/grnDocs", "–");
			this._viewModel.setProperty("/kpi/miroDocs", "–");
			this._loadPlantSection(plant);
			this._loadMonthlySection(plant, this._viewModel.getProperty("/year"));
		},

		onYearChange: function(oEvent) {
			var year = oEvent.getSource().getSelectedKey();
			this._viewModel.setProperty("/year", year);
			this._updateSectionTitles();
			if (this._committedPlant) {
				this._viewModel.setProperty("/monthlyBusy", true);
				this._viewModel.setProperty("/monthlyVisible", false);
				this._viewModel.setProperty("/emptyVisible", false);
				this._loadMonthlySection(this._committedPlant, year);
			}
		},

		_updateSectionTitles: function() {
			var plant = this._committedPlant;
			var year = this._viewModel.getProperty("/year");
			this._viewModel.setProperty("/plantTitle", plant ? "Plant-wise STO Overview · " + plant + " · Year " + year :
				"Plant-wise STO Overview");
			this._viewModel.setProperty("/monthlyTitle", plant ? "Monthly STO Analysis · " + plant + " · Year " + year :
				"Monthly STO Analysis – " + year);
		},

		onClear: function() {
			this.byId("plantInput").setValue("");
			this.byId("plantInput").setValueState("None");
			this._viewModel.setProperty("/plantDraft", "");
			this._committedPlant = "";
			this._updateSectionTitles();
			this._plantRequestId = (this._plantRequestId || 0) + 1;
			this._monthlyRequestId = (this._monthlyRequestId || 0) + 1;
			this._plantLoaded = false;
			this._monthlyLoaded = false;
			this._viewModel.setProperty("/plantVisible", false);
			this._viewModel.setProperty("/monthlyVisible", false);
			this._viewModel.setProperty("/summaryVisible", false);
			this._viewModel.setProperty("/emptyVisible", false);
			this._viewModel.setProperty("/promptVisible", true);
			this._viewModel.setProperty("/plantBusy", false);
			this._viewModel.setProperty("/monthlyBusy", false);
			this._viewModel.setProperty("/error", "");
			this._viewModel.setProperty("/plantError", "");
			this._viewModel.setProperty("/monthlyError", "");
			this._viewModel.setProperty("/kpi/po", "–");
			this._viewModel.setProperty("/kpi/plantCaption", "Select supplying plant");
			this._viewModel.setProperty("/plantDraft", "");
			this._viewModel.setProperty("/plantContext", "—");
			this._viewModel.setProperty("/kpi/pgiDocs", "–");
			this._viewModel.setProperty("/kpi/grnDocs", "–");
			this._viewModel.setProperty("/kpi/miroDocs", "–");
			this.getView().getModel("plant").setData({
				byPlant: [],
				byValue: [],
				table: []
			});
			this.getView().getModel("monthly").setData({
				byMonth: [],
				byMonthlyPlant: [],
				totals: {
					pgi: "0",
					grn: "0"
				},
				table: []
			});
		},

		_loadPlantSection: function(plant) {
			var that = this;
			var model = this.getView().getModel();
			var requestId = (this._plantRequestId || 0) + 1;
			this._plantRequestId = requestId;
			this._readMetadata().then(function(meta) {
				if (requestId !== that._plantRequestId) {
					return;
				}
				var entity = meta.plant;
				var filters = [new Filter(entity.fields.reswk, FilterOperator.EQ, plant)];
				model.read("/" + entity.set, {
					filters: filters,
					success: function(result) {
						if (requestId !== that._plantRequestId) {
							return;
						}
						var rows = result.results || [];
						var normalized = rows.map(function(row) {
							return that._normalizePlantRow(row, entity);
						});
						var grouped = that._groupPlantRows(normalized);
						that.getView().getModel("plant").setData({
							byPlant: grouped.chart,
							byValue: grouped.valueChart,
							table: grouped.table
						});
						var total = normalized.reduce(function(sum, row) {
							return sum + row.po;
						}, 0);
						that._viewModel.setProperty("/kpi/po", that._formatNumber(total));
						that._viewModel.setProperty("/kpi/plantCaption", "Across " + grouped.chart.length + " receiving plant(s)");
						that._resolveDocumentKpis(normalized, entity);
						that._plantLoaded = true;
						that._viewModel.setProperty("/plantBusy", false);
						that._viewModel.setProperty("/plantVisible", normalized.length > 0);
						that._updateDisplayStates();
					},
					error: function(error) {
						if (requestId !== that._plantRequestId) {
							return;
						}
						that._plantLoaded = true;
						that._viewModel.setProperty("/plantBusy", false);
						that._viewModel.setProperty("/kpi/plantCaption", "Plant data could not be loaded");
						that._viewModel.setProperty("/plantError", that._errorText(error, "Plant-wise data could not be loaded."));
						that._appendErrors();
						that._updateDisplayStates();
					}
				});
			}).catch(function(error) {
				if (requestId !== that._plantRequestId) {
					return;
				}
				that._plantLoaded = true;
				that._viewModel.setProperty("/plantBusy", false);
				that._viewModel.setProperty("/kpi/plantCaption", "Plant data could not be loaded");
				that._viewModel.setProperty("/plantError", that._errorText(error, "Plant-wise metadata could not be read."));
				that._appendErrors();
				that._updateDisplayStates();
			});
		},

		_loadMonthlySection: function(plant, year) {
			var that = this;
			var model = this.getView().getModel();
			var requestId = (this._monthlyRequestId || 0) + 1;
			this._monthlyRequestId = requestId;
			this._monthlyLoaded = false;
			this.getView().getModel("monthly").setData({
				byMonth: [],
				byMonthlyPlant: [],
				totals: {
					pgi: "0",
					grn: "0"
				},
				table: []
			});
			this._viewModel.setProperty("/monthlyError", "");
			this._appendErrors();
			this._readMetadata().then(function(meta) {
				if (requestId !== that._monthlyRequestId) {
					return;
				}
				var entity = meta.monthly;
				var filters = [new Filter(entity.fields.reswk, FilterOperator.EQ, plant), new Filter(entity.fields.mjahr, FilterOperator.EQ,
					year)];
				model.read("/" + entity.set, {
					filters: filters,
					success: function(result) {
						if (requestId !== that._monthlyRequestId) {
							return;
						}
						var rows = result.results || [];
						var data = that._aggregateMonthly(rows, entity);
						that.getView().getModel("monthly").setData(data);
						that._monthlyLoaded = true;
						that._viewModel.setProperty("/monthlyBusy", false);
						that._viewModel.setProperty("/monthlyVisible", rows.length > 0);
						that._updateDisplayStates();
					},
					error: function(error) {
						if (requestId !== that._monthlyRequestId) {
							return;
						}
						that._monthlyLoaded = true;
						that._viewModel.setProperty("/monthlyBusy", false);
						that._viewModel.setProperty("/monthlyError", that._errorText(error, "Monthly data could not be loaded."));
						that._appendErrors();
						that._updateDisplayStates();
					}
				});
			}).catch(function(error) {
				if (requestId !== that._monthlyRequestId) {
					return;
				}
				that._monthlyLoaded = true;
				that._viewModel.setProperty("/monthlyBusy", false);
				that._viewModel.setProperty("/monthlyError", that._errorText(error, "Monthly metadata could not be read."));
				that._appendErrors();
				that._updateDisplayStates();
			});
		},

		_readMetadata: function() {
			if (this._metadataPromise) {
				return this._metadataPromise;
			}
			var model = this.getView().getModel();
			this._metadataPromise = model.getMetaModel().loaded().then(function() {
				var metaModel = model.getMetaModel();
				return {
					plant: this._entityDescriptor(metaModel, "es_plant_wiseset", "es_plant_wise", ["werks", "reswk", "ebeln", "dmbtr"]),
					monthly: this._entityDescriptor(metaModel, "es_monthly_stoset", "es_monthly_sto", ["werks", "reswk", "mjahr"].concat(this._monthFields(
						"pgi")).concat(this._monthFields("grn")))
				};
			}.bind(this));
			return this._metadataPromise;
		},

		_entityDescriptor: function(metaModel, setName, typeName, requiredNames) {
			var set = metaModel.getODataEntitySet(setName);
			if (!set) {
				throw new Error("Metadata does not contain entity set " + setName);
			}
			var type = metaModel.getODataEntityType(set.entityType || "ZO_STO_SRV." + typeName);
			if (!type) {
				throw new Error("Metadata does not contain entity type " + typeName);
			}
			var properties = type.property || [];
			var byLower = {};
			properties.forEach(function(property) {
				byLower[property.name.toLowerCase()] = property.name;
			});
			var fields = {};
			requiredNames.forEach(function(name) {
				var match = byLower[name.toLowerCase()];
				if (!match) {
					throw new Error("Metadata field '" + name + "' is missing from " + typeName);
				}
				fields[name] = match;
			});
			return {
				set: setName,
				type: type,
				properties: properties,
				fields: fields
			};
		},

		_normalizePlantRow: function(row, entity) {
			var get = function(name) {
				return row[entity.fields[name]];
			};
			var amount = this._number(get("dmbtr"));
			return {
				werks: String(get("werks") || ""),
				reswk: String(get("reswk") || ""),
				po: this._number(get("ebeln")),
				value: amount / 100000
			};
		},

		_groupPlantRows: function(rows) {
			var byReceiving = {};
			rows.forEach(function(row) {
				var plant = byReceiving[row.werks] || (byReceiving[row.werks] = {
					werks: row.werks,
					po: 0,
					value: 0
				});
				plant.po += row.po;
				plant.value += row.value;
			});
			var allPlants = Object.keys(byReceiving).map(function(key) {
				return byReceiving[key];
			});
			var chart = allPlants.slice().sort(function(a, b) {
				return b.po - a.po;
			});
			var valuePlants = allPlants.slice().sort(function(a, b) {
				return b.value - a.value;
			});
			var valueChart = valuePlants.slice(0, 8).map(function(plant) {
				var value = Number(plant.value.toFixed(1));
				return {
					werks: plant.werks,
					value: value,
					legendLabel: plant.werks + " · " + value.toFixed(1) + " Lakh"
				};
			});
			if (valuePlants.length > 8) {
				var otherValue = valuePlants.slice(8).reduce(function(total, plant) {
					return total + plant.value;
				}, 0);
				otherValue = Number(otherValue.toFixed(1));
				valueChart.push({
					werks: "Others",
					value: otherValue,
					legendLabel: "Others · " + otherValue.toFixed(1) + " Lakh"
				});
			}
			var table = allPlants.slice().sort(function(a, b) {
				return b.po - a.po;
			}).map(function(row) {
				row.value = Number(row.value.toFixed(2));
				return row;
			});
			return {
				chart: chart.slice(0, 30),
				valueChart: valueChart,
				table: table
			};
		},

		_aggregateMonthly: function(rows, entity) {
			var fields = entity.fields;
			var byMonth = MONTHS.map(function(month, index) {
				var suffix = (index + 1 < 10 ? "0" : "") + (index + 1);
				return {
					month: month,
					pgi: 0,
					grn: 0,
					pgiField: fields["pgi_" + suffix],
					grnField: fields["grn_" + suffix],
					index: index
				};
			});
			var byPlant = {};
			var monthlyTable = [];
			rows.forEach(function(row) {
				var werks = String(row[fields.werks] || "");
				var plant = byPlant[werks] || (byPlant[werks] = {
					werks: werks,
					pgi: 0,
					grn: 0,
					months: MONTHS.map(function(month) {
						return {
							month: month,
							pgi: 0,
							grn: 0
						};
					})
				});
				byMonth.forEach(function(month) {
					var pgi = this._number(row[month.pgiField]);
					var grn = this._number(row[month.grnField]);
					month.pgi += pgi;
					month.grn += grn;
					plant.pgi += pgi;
					plant.grn += grn;
					plant.months[month.index].pgi += pgi;
					plant.months[month.index].grn += grn;
				}, this);
			}, this);
			var monthlyPlant = Object.keys(byPlant).map(function(key) {
				return byPlant[key];
			}).sort(function(a, b) {
				return b.pgi - a.pgi;
			});
			var totals = byMonth.reduce(function(result, month) {
				result.pgi += month.pgi;
				result.grn += month.grn;
				return result;
			}, {
				pgi: 0,
				grn: 0
			});
			monthlyPlant.forEach(function(plant) {
				plant.months.forEach(function(month) {
					monthlyTable.push({
						werks: plant.werks,
						month: month.month,
						pgi: month.pgi,
						grn: month.grn
					});
				});
			});
			return {
				byMonth: byMonth.map(function(item) {
					return {
						month: item.month,
						pgi: item.pgi,
						grn: item.grn
					};
				}),
				byMonthlyPlant: monthlyPlant.slice(0, 30).map(function(plant) {
					return {
						werks: plant.werks,
						pgi: plant.pgi,
						grn: plant.grn
					};
				}),
				totals: {
					pgi: this._formatNumber(totals.pgi),
					grn: this._formatNumber(totals.grn)
				},
				table: monthlyTable
			};
		},

		_resolveDocumentKpis: function(rows, entity) {
			var properties = entity.properties.map(function(property) {
				return property.name.toLowerCase();
			});
			["pgi", "grn", "miro"].forEach(function(kind) {
				var name = DOC_FIELDS[kind];
				var exists = properties.indexOf(name.toLowerCase()) !== -1;
				if (exists) {
					var field = entity.properties.filter(function(property) {
						return property.name.toLowerCase() === name.toLowerCase();
					})[0].name;
					var total = rows.reduce(function(sum, row) {
						return sum + this._number(row[field]);
					}.bind(this), 0);
					this._viewModel.setProperty("/kpi/" + kind + "Docs", this._formatNumber(total));
				} else {
					this._viewModel.setProperty("/kpi/" + kind + "Docs", "–");
				}
			}, this);
		},

		_monthFields: function(prefix) {
			var fields = [];
			for (var i = 1; i <= 12; i++) {
				fields.push(prefix + "_" + (i < 10 ? "0" : "") + i);
			}
			return fields;
		},

		_number: function(value) {
			if (value === null || value === undefined || value === "") {
				return 0;
			}
			var number = Number(String(value).replace(/,/g, ""));
			return isFinite(number) ? number : 0;
		},

		_formatNumber: function(value) {
			return new Intl.NumberFormat("en-IN", {
				maximumFractionDigits: 0
			}).format(value || 0);
		},

		_formatDate: function(value) {
			if (!value) {
				return "";
			}
			var match = String(value).match(/^(\d{4})(\d{2})(\d{2})$/);
			if (match) {
				return Number(match[3]) + " " + MONTHS[Number(match[2]) - 1] + " " + match[1];
			}
			return String(value);
		},

		_updateDisplayStates: function() {
			var hasPlant = (this.getView().getModel("plant").getProperty("/table") || []).length > 0;
			var hasMonthly = (this.getView().getModel("monthly").getProperty("/table") || []).length > 0;
			this._viewModel.setProperty("/summaryVisible", hasPlant || hasMonthly);
			var finished = this._plantLoaded && this._monthlyLoaded;
			var hasError = !!this._viewModel.getProperty("/plantError") || !!this._viewModel.getProperty("/monthlyError");
			this._viewModel.setProperty("/emptyVisible", finished && !hasPlant && !hasMonthly && !hasError);
		},

		_appendErrors: function() {
			var errors = [this._viewModel.getProperty("/plantError"), this._viewModel.getProperty("/monthlyError")].filter(Boolean);
			this._viewModel.setProperty("/error", errors.join(" "));
		},

		_errorText: function(error, fallback) {
			if (error && error.responseText) {
				try {
					var payload = JSON.parse(error.responseText);
					var serviceMessage = payload.error && payload.error.message;
					if (serviceMessage) {
						return typeof serviceMessage === "string" ? serviceMessage : (serviceMessage.value || fallback);
					}
				} catch (ignore) {
					// Keep the concise fallback below for non-JSON gateway responses.
				}
			}
			if (error && error.message) {
				return error.message;
			}
			if (error && error.statusCode) {
				return fallback + " (HTTP " + error.statusCode + ")";
			}
			return fallback;
		},

		onPlantSearch: function(event) {
			this._applyTableSearch("plantTable", ["werks"], event.getParameter("newValue"));
		},
		onMonthlySearch: function(event) {
			this._applyTableSearch("monthlyTable", ["werks", "month"], event.getParameter("newValue"));
		},
		_applyTableSearch: function(tableId, fields, query) {
			var binding = this.byId(tableId).getBinding("rows");
			if (!query) {
				binding.filter([]);
				return;
			}
			binding.filter([new Filter({
				filters: fields.map(function(field) {
					return new Filter(field, FilterOperator.Contains, query);
				}),
				and: false
			})]);
		},

		onExportPlant: function() {
			this._export("plantTable", [{
				label: "Receiving Plant",
				property: "werks"
			}, {
				label: "STO POs",
				property: "po",
				type: "Number"
			}, {
				label: "PGI Value (INR Lakh)",
				property: "value",
				type: "Number"
			}], "STO_Plant_Summary.xlsx");
		},
		onExportMonthly: function() {
			this._export("monthlyTable", [{
				label: "Receiving Plant",
				property: "werks"
			}, {
				label: "Month",
				property: "month"
			}, {
				label: "PGI Records",
				property: "pgi",
				type: "Number"
			}, {
				label: "GRN Records",
				property: "grn",
				type: "Number"
			}], "STO_Monthly_Summary.xlsx");
		},
		_export: function(tableId, columns, filename) {
			var table = this.byId(tableId);
			var binding = table.getBinding("rows");
			var settings = {
				workbook: {
					columns: columns,
					context: {
						sheetName: "STO Summary"
					}
				},
				dataSource: binding,
				fileName: filename,
				worker: false
			};
			new Spreadsheet(settings).build().finally(function() {
				settings = null;
			});
		}
	});
});